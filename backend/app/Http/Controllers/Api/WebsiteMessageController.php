<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WebsiteMessage;
use App\Support\Bn;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/** The website's contact form, and the office's inbox for it. */
class WebsiteMessageController extends Controller
{
    /** Per mobile number per day — besides the per-minute limit on the route. */
    private const DAILY_PER_MOBILE = 3;

    /** Public: a visitor sends a message. */
    public function store(Request $request): JsonResponse
    {
        $request->merge(['mobile' => Bn::toEnDigits(trim((string) $request->input('mobile')))]);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'mobile' => ['required', 'regex:/^01[3-9]\d{8}$/'],
            'email' => ['nullable', 'email', 'max:100'],
            'subject' => ['required', 'string', 'max:150'],
            'message' => ['required', 'string', 'min:5', 'max:3000'],
            // a hidden field people leave empty; simple bots fill it
            'website' => ['nullable', 'max:0'],
        ], [
            'mobile.regex' => __('মোবাইল নম্বর ০১XXXXXXXXX আকারে দিন।'),
            'website.max' => __('বার্তা পাঠানো যায়নি।'),
        ]);
        if (WebsiteMessage::where('mobile', $data['mobile'])->where('created_at', '>=', now()->subDay())->count() >= self::DAILY_PER_MOBILE) {
            throw ValidationException::withMessages(['mobile' => __('এই নম্বর থেকে আজ আর বার্তা পাঠানো যাবে না। প্রয়োজনে ফোন করুন।')]);
        }
        unset($data['website']);
        WebsiteMessage::create($data + ['ip' => $request->ip()]);

        return response()->json(['message' => __('আপনার বার্তা পাঠানো হয়েছে। অফিস থেকে শীঘ্রই যোগাযোগ করা হবে।')], 201);
    }

    public function index(Request $request): JsonResponse
    {
        $q = WebsiteMessage::with('reader:id,name_bn,name_en')->latest('id');
        if ($request->query('status') === 'unread') {
            $q->whereNull('read_at');
        } elseif ($request->query('status') === 'read') {
            $q->whereNotNull('read_at');
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('name', 'like', "%$search%")->orWhere('mobile', 'like', "%$en%")
                ->orWhere('subject', 'like', "%$search%")->orWhere('message', 'like', "%$search%"));
        }

        return response()->json($q->paginate($this->perPage($request))->toArray() + [
            'unread' => WebsiteMessage::whereNull('read_at')->count(),
            'total_all' => WebsiteMessage::count(),
        ]);
    }

    /** Mark read/unread and keep a note of what was done. */
    public function update(Request $request, WebsiteMessage $message): JsonResponse
    {
        $data = $request->validate([
            'read' => ['sometimes', 'boolean'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        if (array_key_exists('read', $data)) {
            $message->fill($data['read'] ? ['read_at' => $message->read_at ?? now(), 'read_by' => $message->read_by ?? $request->user()->id] : ['read_at' => null, 'read_by' => null]);
        }
        if (array_key_exists('note', $data)) {
            $message->note = $data['note'];
        }
        $message->save();

        return response()->json($message->load('reader:id,name_bn,name_en'));
    }

    public function destroy(WebsiteMessage $message): JsonResponse
    {
        $message->delete();

        return response()->json(['message' => __('বার্তা মুছে ফেলা হয়েছে।')]);
    }
}
