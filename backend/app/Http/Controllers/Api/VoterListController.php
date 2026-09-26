<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\VoterList;
use App\Models\VoterListItem;
use App\Services\VoterListService;
use App\Support\Bn;
use App\Support\CsvExport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VoterListController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(VoterList::with('creator:id,name_bn')->latest('id')->paginate($this->perPage($request)));
    }

    public function store(Request $request, VoterListService $service): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'cutoff_date' => ['required', 'date'],
        ]);

        return response()->json($service->generate($data['title'], $data['cutoff_date'], $request->user()->id), 201);
    }

    /** eligible=1 → voter list, eligible=0 → voter audit (who was left out and why). */
    public function show(Request $request, VoterList $voterList): JsonResponse
    {
        $items = $voterList->items()
            ->when($request->filled('eligible'), fn ($q) => $q->where('eligible', $request->boolean('eligible')))
            ->orderByRaw('serial is null')->orderBy('serial')->orderBy('member_no')
            ->paginate($request->integer('per_page', 100) ?: 100);

        return response()->json(['list' => $voterList->load('creator:id,name_bn'), 'items' => $items]);
    }

    /**
     * People on one voter list (default: the latest) with their member and
     * farmer details, filters, and header figures compared with the list
     * before it.
     */
    public function voters(Request $request): JsonResponse
    {
        $lists = VoterList::latest('cutoff_date')->latest('id')->get(['id', 'title', 'cutoff_date', 'eligible_count', 'ineligible_count']);
        $list = $request->filled('list_id') ? $lists->firstWhere('id', $request->integer('list_id')) : $lists->first();
        if (! $list) {
            return response()->json(['list' => null, 'lists' => [], 'summary' => null, 'items' => ['data' => [], 'total' => 0]]);
        }
        $previous = $lists->first(fn ($l) => $l->cutoff_date->lt($list->cutoff_date) || ($l->cutoff_date->eq($list->cutoff_date) && $l->id < $list->id));

        $q = VoterListItem::query()->where('voter_list_items.voter_list_id', $list->id)
            ->join('members', 'members.id', '=', 'voter_list_items.member_id')
            ->join('farmers', 'farmers.id', '=', 'members.farmer_id')
            ->leftJoin('mouzas', 'mouzas.id', '=', 'farmers.mouza_id')
            ->select('voter_list_items.*', 'members.status as member_status', 'members.admitted_on', 'farmers.id as farmer_id', 'farmers.farmer_code',
                'farmers.name_en', 'farmers.mobile', 'farmers.nid', 'farmers.photo', 'farmers.education_level', 'farmers.occupation', 'mouzas.name_bn as mouza');
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('voter_list_items.name', 'like', "%$search%")->orWhere('farmers.name_en', 'like', "%$search%")
                ->orWhere('voter_list_items.father_name', 'like', "%$search%")->orWhere('farmers.mobile', 'like', "%$en%")->orWhere('farmers.nid', $en)
                ->when(ctype_digit($en), fn ($x) => $x->orWhere('voter_list_items.member_no', (int) $en)->orWhere('voter_list_items.serial', (int) $en)));
        }
        if ($request->filled('eligible')) {
            $q->where('voter_list_items.eligible', $request->boolean('eligible'));
        }
        if ($request->filled('member_status')) {
            $q->where('members.status', $request->query('member_status'));
        }
        foreach (['mouza_id', 'education_level', 'occupation'] as $f) {
            if ($request->filled($f)) {
                $q->where('farmers.'.$f, $request->query($f));
            }
        }
        if ($request->filled('from')) {
            $q->where('members.admitted_on', '>=', $request->date('from')->toDateString());
        }
        if ($request->filled('to')) {
            $q->where('members.admitted_on', '<=', $request->date('to')->toDateString());
        }
        $page = $q->orderByDesc('voter_list_items.eligible')->orderBy('voter_list_items.serial')->orderBy('voter_list_items.member_no')
            ->paginate($this->perPage($request))
            ->through(fn ($i) => $i->toArray() + ['photo_url' => $i->photo ? url("api/farmers/{$i->farmer_id}/photo") : null]);

        // new = a voter now who was not one on the previous list
        $eligibleIds = fn (VoterList $l) => VoterListItem::where('voter_list_id', $l->id)->where('eligible', true)->pluck('member_id');
        $new = $previous ? $eligibleIds($list)->diff($eligibleIds($previous))->count() : (int) $list->eligible_count;
        $newBefore = null;
        if ($previous && ($older = $lists->first(fn ($l) => $l->cutoff_date->lt($previous->cutoff_date)))) {
            $newBefore = $eligibleIds($previous)->diff($eligibleIds($older))->count();
        }
        $pct = fn ($now, $before) => $before ? round(($now - $before) / $before * 100, 1) : null;

        return response()->json([
            'list' => $list,
            'previous' => $previous?->only(['id', 'title', 'cutoff_date']),
            'lists' => $lists,
            'summary' => [
                'total' => $list->eligible_count + $list->ineligible_count,
                'eligible' => (int) $list->eligible_count,
                'excluded' => (int) $list->ineligible_count,
                'new' => $new,
                'change' => [
                    'total' => $previous ? $pct($list->eligible_count + $list->ineligible_count, $previous->eligible_count + $previous->ineligible_count) : null,
                    'eligible' => $previous ? $pct($list->eligible_count, $previous->eligible_count) : null,
                    'excluded' => $previous ? $pct($list->ineligible_count, $previous->ineligible_count) : null,
                    'new' => $pct($new, $newBefore),
                ],
            ],
            'items' => $page,
        ]);
    }

    public function export(Request $request, VoterList $voterList)
    {
        $eligible = $request->boolean('eligible', true);
        $rows = $voterList->items()->where('eligible', $eligible)->orderBy('serial')->orderBy('member_no')->lazy()
            ->map(fn ($i) => $eligible
                ? [$i->serial, $i->member_no, $i->name, $i->father_name, $i->village, '']
                : [$i->member_no, $i->name, $i->father_name, $i->village, $i->reason]);

        $headers = $eligible ? [__('ক্রমিক'), __('সদস্য নং'), __('নাম'), __('পিতা'), __('গ্রাম'), __('স্বাক্ষর')] : [__('সদস্য নং'), __('নাম'), __('পিতা'), __('গ্রাম'), __('বাদ পড়ার কারণ')];

        return CsvExport::download(($eligible ? 'voters-' : 'voter-audit-').$voterList->cutoff_date->format('Ymd').'.csv', $headers, $rows);
    }
}
