<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\District;
use App\Models\Division;
use App\Models\Location;
use App\Models\Union;
use App\Models\Upazila;
use App\Models\Village;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** One controller for all five levels: /locations/{level} */
class LocationController extends Controller
{
    private const LEVELS = [
        'divisions' => Division::class,
        'districts' => District::class,
        'upazilas' => Upazila::class,
        'unions' => Union::class,
        'villages' => Village::class,
    ];

    public function index(Request $request, string $level): JsonResponse
    {
        $class = $this->model($level);
        $q = $class::query()->orderBy('name_bn');

        if (($parent = $class::parentKey()) && $request->filled('parent_id')) {
            $q->where($parent, $request->query('parent_id'));
        }
        if ($request->boolean('active_only')) {
            $q->where('is_active', true);
        }
        if ($search = $request->query('search')) {
            $q->where(fn ($w) => $w->where('name_bn', 'like', "%$search%")->orWhere('name_en', 'like', "%$search%"));
        }

        return response()->json($q->get());
    }

    public function store(Request $request, string $level): JsonResponse
    {
        $class = $this->model($level);

        return response()->json($class::create($this->validated($request, $level, $class)), 201);
    }

    public function update(Request $request, string $level, int $id): JsonResponse
    {
        $class = $this->model($level);
        $item = $class::findOrFail($id);
        $item->update($this->validated($request, $level, $class, $item));

        return response()->json($item);
    }

    private function validated(Request $request, string $level, string $class, ?Location $item = null): array
    {
        $rules = [
            'name_bn' => ['required', 'string', 'max:150'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'code' => ['nullable', 'string', 'max:20'],
            'is_active' => ['boolean'],
        ];
        if ($parent = $class::parentKey()) {
            $parentTable = array_search(
                $parent, ['divisions' => 'division_id', 'districts' => 'district_id', 'upazilas' => 'upazila_id', 'unions' => 'union_id'], true
            );
            $rules[$parent] = [$item ? 'sometimes' : 'required', Rule::exists($parentTable, 'id')];
            $rules['name_bn'][] = Rule::unique($level, 'name_bn')
                ->where($parent, $request->input($parent, $item?->{$parent}))
                ->ignore($item);
        } else {
            $rules['name_bn'][] = Rule::unique($level, 'name_bn')->ignore($item);
        }

        return $request->validate($rules, ['name_bn.unique' => 'এই নামে একই স্তরে আগে থেকেই আছে।']);
    }

    /** @return class-string<Location> */
    private function model(string $level): string
    {
        abort_unless(isset(self::LEVELS[$level]), 404);

        return self::LEVELS[$level];
    }
}
