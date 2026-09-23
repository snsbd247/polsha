<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Mouza;
use App\Models\Union;
use App\Support\Bn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MouzaController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = Mouza::query()->with(['union:id,name_bn,upazila_id', 'upazila:id,name_bn', 'villages:id,name_bn']);

        if ($search = $request->query('search')) {
            $q->where(fn ($w) => $w->where('name_bn', 'like', "%$search%")
                ->orWhere('name_en', 'like', "%$search%")
                ->orWhere('jl_no', 'like', "%$search%"));
        }
        foreach (['union_id', 'upazila_id'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('village_id')) {
            $q->whereHas('villages', fn ($w) => $w->where('villages.id', $request->query('village_id')));
        }
        if ($request->filled('is_active')) {
            $q->where('is_active', $request->boolean('is_active'));
        }

        // Lightweight list for dropdowns.
        if ($request->boolean('all')) {
            return response()->json($q->where('is_active', true)->orderBy('name_bn')->get(['id', 'name_bn', 'jl_no', 'union_id', 'upazila_id']));
        }

        return response()->json($q->orderBy('name_bn')->paginate($this->perPage($request)));
    }

    public function show(Mouza $mouza): JsonResponse
    {
        return response()->json($mouza->load(['union.upazila.district.division', 'villages:id,name_bn']));
    }

    public function store(Request $request): JsonResponse
    {
        [$data, $villages] = $this->validated($request);

        $mouza = DB::transaction(function () use ($data, $villages) {
            $mouza = Mouza::create($data);
            $mouza->villages()->sync($villages);

            return $mouza;
        });

        return response()->json($mouza->load('villages:id,name_bn'), 201);
    }

    public function update(Request $request, Mouza $mouza): JsonResponse
    {
        [$data, $villages] = $this->validated($request, $mouza);

        DB::transaction(function () use ($mouza, $data, $villages) {
            $mouza->update($data);
            $mouza->villages()->sync($villages);
        });

        return response()->json($mouza->fresh('villages:id,name_bn'));
    }

    private function validated(Request $request, ?Mouza $mouza = null): array
    {
        $request->merge(['jl_no' => Bn::toEnDigits($request->input('jl_no'))]);
        $union = Union::find($request->input('union_id'));

        $data = $request->validate([
            'union_id' => ['required', 'exists:unions,id'],
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'jl_no' => ['required', 'string', 'max:20',
                Rule::unique('mouzas')->where('upazila_id', $union?->upazila_id)->ignore($mouza)],
            'village_ids' => ['array'],
            'village_ids.*' => [Rule::exists('villages', 'id')->where('union_id', $union?->id)],
            'is_active' => ['boolean'],
        ], ['jl_no.unique' => 'এই উপজেলায় একই JL নম্বরের মৌজা আগে থেকেই আছে।']);

        $villages = $data['village_ids'] ?? [];
        unset($data['village_ids']);
        $data['upazila_id'] = $union->upazila_id;

        return [$data, $villages];
    }
}
