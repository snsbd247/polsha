<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Models\Household;
use App\Services\SequenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class HouseholdController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Household::query()
            ->with(['head:id,name_bn,farmer_code', 'village:id,name_bn'])
            ->withCount(['farmers', 'farmers as members_count' => fn ($f) => $f->whereHas('member', fn ($m) => $m->where('status', 'active'))]);

        if ($search = trim((string) $request->query('search'))) {
            $q->where(fn ($w) => $w->where('code', 'like', "%$search%")
                ->orWhereHas('head', fn ($h) => $h->where('name_bn', 'like', "%$search%")));
        }
        if ($request->filled('village_id')) {
            $q->where('village_id', $request->query('village_id'));
        }

        return response()->json($q->orderByDesc('id')->paginate($this->perPage($request)));
    }

    /** Picker search. */
    public function lookup(Request $request): JsonResponse
    {
        $term = trim((string) $request->query('q'));

        return response()->json(Household::with('head:id,name_bn', 'village:id,name_bn')
            ->when($term, fn ($q) => $q->where(fn ($w) => $w->where('code', 'like', "%$term%")
                ->orWhereHas('head', fn ($h) => $h->where('name_bn', 'like', "%$term%"))))
            ->limit(20)->get());
    }

    public function show(Household $household): JsonResponse
    {
        return response()->json($household->load([
            'head:id,name_bn,farmer_code',
            'village:id,name_bn',
            'farmers' => fn ($q) => $q->with('member:id,farmer_id,member_no,status')
                ->select('id', 'farmer_code', 'name_bn', 'father_name', 'household_id', 'household_relation', 'is_active'),
        ]));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'head_farmer_id' => ['required', 'exists:farmers,id'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $head = Farmer::findOrFail($data['head_farmer_id']);
        if ($head->household_id) {
            throw ValidationException::withMessages(['head_farmer_id' => 'এই কৃষক ইতিমধ্যে একটি খানার সদস্য।']);
        }

        $household = DB::transaction(function () use ($head, $data) {
            $h = Household::create([
                'code' => SequenceService::next('household'),
                'village_id' => $head->village_id,
                'head_farmer_id' => $head->id,
                'remarks' => $data['remarks'] ?? null,
            ]);
            $head->update(['household_id' => $h->id, 'household_relation' => 'self']);

            return $h;
        });

        return response()->json($household, 201);
    }

    public function changeHead(Request $request, Household $household): JsonResponse
    {
        $data = $request->validate(['head_farmer_id' => ['required', Rule::exists('farmers', 'id')->where('household_id', $household->id)]],
            ['head_farmer_id.exists' => 'খানাপ্রধানকে অবশ্যই এই খানার সদস্য হতে হবে।']);

        DB::transaction(function () use ($household, $data) {
            if ($household->head_farmer_id) {
                Farmer::whereKey($household->head_farmer_id)->update(['household_relation' => 'other']);
            }
            $household->update(['head_farmer_id' => $data['head_farmer_id']]);
            Farmer::whereKey($data['head_farmer_id'])->first()->update(['household_relation' => 'self']);
        });

        return $this->show($household->fresh());
    }

    public function addMember(Request $request, Household $household): JsonResponse
    {
        $data = $request->validate([
            'farmer_id' => ['required', 'exists:farmers,id'],
            'relation' => ['required', Rule::in(array_keys(config('erp.farmer.relations')))],
        ]);
        $farmer = Farmer::findOrFail($data['farmer_id']);
        if ($farmer->household_id && $farmer->household_id !== $household->id) {
            throw ValidationException::withMessages(['farmer_id' => 'এই কৃষক অন্য একটি খানার সদস্য।']);
        }
        $farmer->update(['household_id' => $household->id, 'household_relation' => $data['relation']]);

        return $this->show($household->fresh());
    }

    public function removeMember(Household $household, Farmer $farmer): JsonResponse
    {
        abort_unless($farmer->household_id === $household->id, 404);
        if ($household->head_farmer_id === $farmer->id) {
            throw ValidationException::withMessages(['farmer_id' => 'খানাপ্রধানকে বাদ দেওয়া যাবে না; আগে খানাপ্রধান বদলান।']);
        }
        $farmer->update(['household_id' => null, 'household_relation' => null]);

        return $this->show($household->fresh());
    }
}
