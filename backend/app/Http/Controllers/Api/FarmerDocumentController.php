<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Farmer;
use App\Models\FarmerDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class FarmerDocumentController extends Controller
{
    public function index(Farmer $farmer): JsonResponse
    {
        return response()->json($farmer->documents()->with('uploader:id,name_bn')->get());
    }

    public function store(Request $request, Farmer $farmer): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(array_keys(config('erp.farmer.document_types')))],
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
            'remarks' => ['nullable', 'string', 'max:500'],
        ]);
        $file = $request->file('file');

        $doc = $farmer->documents()->create([
            'type' => $data['type'],
            // Private disk: files are only reachable through the authenticated download route.
            'path' => $file->store("farmer-docs/{$farmer->id}", 'local'),
            'original_name' => mb_substr($file->getClientOriginalName(), 0, 250),
            'mime' => $file->getMimeType(),
            'size' => $file->getSize(),
            'remarks' => $data['remarks'] ?? null,
            'uploaded_by' => $request->user()->id,
        ]);

        return response()->json($doc->load('uploader:id,name_bn'), 201);
    }

    public function download(Farmer $farmer, FarmerDocument $document)
    {
        abort_unless($document->farmer_id === $farmer->id && Storage::disk('local')->exists($document->path), 404);

        return Storage::disk('local')->response($document->path, $document->original_name);
    }

    public function destroy(Farmer $farmer, FarmerDocument $document): JsonResponse
    {
        abort_unless($document->farmer_id === $farmer->id, 404);
        Storage::disk('local')->delete($document->path);
        $document->delete();

        return response()->json(['message' => __('ডকুমেন্ট মুছে ফেলা হয়েছে।')]);
    }
}
