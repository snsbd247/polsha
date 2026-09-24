<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SmsLog;
use App\Models\SmsTemplate;
use App\Services\SettingService;
use App\Services\SmsService;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class SmsController extends Controller
{
    private const KEYS = ['sms_enabled', 'sms_gateway_url', 'sms_http_method', 'sms_sender_id', 'sms_success_text',
        'sms_auto_payment', 'sms_auto_savings', 'sms_reminders', 'sms_reminder_days'];

    public function __construct(private SmsService $sms) {}

    /** Gateway settings; the API key never leaves the server, only whether it is set. */
    public function settings(): JsonResponse
    {
        $all = SettingService::all();
        $out = array_intersect_key($all, array_flip(self::KEYS));
        $out['sms_api_key_set'] = (string) $all['sms_api_key'] !== '';
        $out['configured'] = SmsService::configured();

        return response()->json($out);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'sms_enabled' => ['required', 'boolean'],
            'sms_gateway_url' => ['nullable', 'string', 'max:1000', 'regex:#^https?://#i'],
            'sms_http_method' => ['required', 'in:GET,POST'],
            'sms_api_key' => ['nullable', 'string', 'max:300'],
            'clear_api_key' => ['sometimes', 'boolean'],
            'sms_sender_id' => ['nullable', 'string', 'max:50'],
            'sms_success_text' => ['nullable', 'string', 'max:100'],
            'sms_auto_payment' => ['required', 'boolean'],
            'sms_auto_savings' => ['required', 'boolean'],
            'sms_reminders' => ['required', 'boolean'],
            'sms_reminder_days' => ['required', 'integer', 'between:0,30'],
        ]);
        if ($data['sms_enabled'] && trim((string) ($data['sms_gateway_url'] ?? '')) === '') {
            throw ValidationException::withMessages(['sms_gateway_url' => __('SMS চালু করতে গেটওয়ে URL দিন।')]);
        }
        // An empty key field means "keep the saved one"; clearing is explicit.
        if ($request->boolean('clear_api_key')) {
            $data['sms_api_key'] = '';
        } elseif (trim((string) ($data['sms_api_key'] ?? '')) === '') {
            unset($data['sms_api_key']);
        }
        unset($data['clear_api_key']);
        foreach (['sms_gateway_url', 'sms_sender_id', 'sms_success_text'] as $k) {
            $data[$k] = (string) ($data[$k] ?? '');
        }
        SettingService::setMany($data);

        return $this->settings();
    }

    public function test(Request $request): JsonResponse
    {
        $data = $request->validate(['mobile' => ['required', 'string', 'max:20'], 'message' => ['nullable', 'string', 'max:500']]);
        $mobile = SmsService::normalize($data['mobile']);
        if (! $mobile) {
            throw ValidationException::withMessages(['mobile' => __('সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।')]);
        }
        $message = ($data['message'] ?? null) ?: __('পরীক্ষামূলক SMS — :society', ['society' => SettingService::get('society_name_bn')]);
        $log = $this->sms->send($this->sms->queueRaw($mobile, $message, 'test'));

        return response()->json($log);
    }

    public function templates(): JsonResponse
    {
        return response()->json(SmsTemplate::orderBy('id')->get());
    }

    public function updateTemplate(Request $request, SmsTemplate $smsTemplate): JsonResponse
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'max:600'],
            'name_en' => ['nullable', 'string', 'max:150'],
            'is_active' => ['required', 'boolean'],
        ]);
        preg_match_all('/\{(\w+)\}/', $data['body'], $m);
        $unknown = array_diff($m[1], (array) $smsTemplate->variables);
        if ($unknown) {
            throw ValidationException::withMessages(['body' => __('অচেনা চলক: :v', ['v' => implode(', ', array_map(fn ($v) => '{'.$v.'}', $unknown))])]);
        }
        $smsTemplate->update($data);

        return response()->json($smsTemplate);
    }

    /** Sample text of a template with its own variable names filled in. */
    public function preview(Request $request, SmsTemplate $smsTemplate): JsonResponse
    {
        $body = (string) $request->input('body', $smsTemplate->body);
        $sample = ['name' => __('রহিম উদ্দিন'), 'amount' => '1,500.00', 'receipt_no' => 'RCP-2026-00012', 'date' => now()->format('d/m/Y'),
            'code' => '482913', 'minutes' => '10', 'account_no' => 'SAV-00031', 'balance' => '12,400.00', 'season' => __('বোরো ২০২৬'),
            'due_date' => now()->addDays(3)->format('d/m/Y'), 'loan_no' => 'LN-2026-0004', 'method' => __('বিকাশ'), 'trx_id' => 'BK7X2M9Q1A',
            'reason' => __('ট্রানজেকশন আইডি মেলেনি')];
        $text = $this->sms->render($body, $sample);

        return response()->json(['text' => $text, 'length' => mb_strlen($text), 'parts' => (int) ceil(mb_strlen($text) / 70)]);
    }

    public function logs(Request $request): JsonResponse
    {
        $q = SmsLog::with('creator:id,name_bn,name_en')->latest('id');
        foreach (['status', 'template_key'] as $f) {
            $request->filled($f) && $q->where($f, $request->query($f));
        }
        if ($s = $request->query('q')) {
            $q->where(fn ($w) => $w->where('mobile', 'like', '%'.$s.'%')->orWhere('message', 'like', '%'.$s.'%'));
        }
        $request->filled('from') && $q->where('created_at', '>=', $request->date('from')->startOfDay());
        $request->filled('to') && $q->where('created_at', '<=', $request->date('to')->endOfDay());
        $counts = SmsLog::selectRaw('status, count(*) as n')->groupBy('status')->pluck('n', 'status');

        return response()->json($q->paginate($this->perPage($request))->toArray() + [
            'counts' => $counts, 'statuses' => Tr::map(SmsLog::STATUSES), 'configured' => SmsService::configured(),
            'templates' => SmsTemplate::orderBy('id')->get(['key', 'name_bn', 'name_en']),
        ]);
    }

    public function retry(SmsLog $smsLog): JsonResponse
    {
        if ($smsLog->status === 'sent') {
            throw ValidationException::withMessages(['status' => __('এই SMS আগেই পাঠানো হয়েছে।')]);
        }
        $smsLog->update(['status' => 'pending', 'attempts' => 0]);

        return response()->json($this->sms->send($smsLog));
    }

    /** Send the waiting outbox now instead of waiting for the scheduler. */
    public function process(): JsonResponse
    {
        return response()->json($this->sms->process(200));
    }
}
