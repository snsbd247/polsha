<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Services\FarmerDuplicateService;
use App\Services\FarmerMergeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Validation\Rule;

class DuplicateController extends Controller
{
    public function __construct(private FarmerDuplicateService $duplicates, private FarmerMergeService $merge) {}

    public function index(Request $request): JsonResponse
    {
        $pairs = $this->duplicates->pairs();
        $perPage = $this->perPage($request);
        $page = max(1, $request->integer('page', 1));

        return response()->json(new LengthAwarePaginator($pairs->forPage($page, $perPage)->values(), $pairs->count(), $perPage, $page));
    }

    public function dismiss(Request $request): JsonResponse
    {
        $data = $request->validate([
            'a' => ['required', 'exists:farmers,id'],
            'b' => ['required', 'exists:farmers,id', 'different:a'],
        ]);
        $this->duplicates->dismiss($data['a'], $data['b'], $request->user()->id);

        return response()->json(['message' => __('এই জোড়া আর ডুপ্লিকেট হিসেবে দেখাবে না।')]);
    }

    /** Side-by-side data for the merge screen. */
    public function compare(Request $request): JsonResponse
    {
        $ids = $request->validate(['a' => ['required', 'integer'], 'b' => ['required', 'integer']]);
        $load = fn ($id) => Farmer::with(['village:id,name_bn', 'mouza:id,name_bn', 'member:id,farmer_id,member_no,status', 'household:id,code'])
            ->withCount('documents')->findOrFail($id);

        return response()->json([
            'a' => $load($ids['a']),
            'b' => $load($ids['b']),
            'fields' => FarmerMergeService::MERGEABLE,
        ]);
    }

    public function requestMerge(Request $request): JsonResponse
    {
        $fields = FarmerMergeService::MERGEABLE;
        $data = $request->validate([
            'keep_id' => ['required', 'exists:farmers,id'],
            'remove_id' => ['required', 'exists:farmers,id', 'different:keep_id'],
            'choices' => ['array'],
            'choices.*' => [Rule::in(['keep', 'remove'])],
        ]);
        $choices = array_intersect_key($data['choices'] ?? [], array_flip($fields));

        $req = $this->merge->request(Farmer::findOrFail($data['keep_id']), Farmer::findOrFail($data['remove_id']), $choices);

        return response()->json([
            'approval_id' => $req->id,
            'status' => $req->status,
            'message' => $req->status === 'approved' ? __('মার্জ সম্পন্ন হয়েছে।') : __('মার্জ অনুরোধ অনুমোদনের জন্য পাঠানো হয়েছে।'),
        ], 201);
    }
}
