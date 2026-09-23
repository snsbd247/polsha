<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\VoterList;
use App\Services\VoterListService;
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

    public function export(Request $request, VoterList $voterList)
    {
        $eligible = $request->boolean('eligible', true);
        $rows = $voterList->items()->where('eligible', $eligible)->orderBy('serial')->orderBy('member_no')->lazy()
            ->map(fn ($i) => $eligible
                ? [$i->serial, $i->member_no, $i->name, $i->father_name, $i->village, '']
                : [$i->member_no, $i->name, $i->father_name, $i->village, $i->reason]);

        $headers = $eligible ? ['ক্রমিক', 'সদস্য নং', 'নাম', 'পিতা', 'গ্রাম', 'স্বাক্ষর'] : ['সদস্য নং', 'নাম', 'পিতা', 'গ্রাম', 'বাদ পড়ার কারণ'];

        return CsvExport::download(($eligible ? 'voters-' : 'voter-audit-').$voterList->cutoff_date->format('Ymd').'.csv', $headers, $rows);
    }
}
