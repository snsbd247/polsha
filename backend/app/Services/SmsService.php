<?php

namespace App\Services;

use App\Models\SmsLog;
use App\Models\SmsTemplate;
use App\Support\Bn;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * SMS through any HTTP gateway configured in Settings. The gateway URL is a
 * template, e.g. https://api.example.com/send?api_key={api_key}&senderid={sender_id}&number={mobile88}&message={message}
 * — GET calls it as is, POST sends its query part as a form body. Messages
 * are queued in sms_logs and drained by the scheduler; with SMS switched
 * off or no URL the message is kept as "logged" and never leaves the server.
 */
class SmsService
{
    public const MAX_ATTEMPTS = 3;

    public static function configured(): bool
    {
        $s = SettingService::all();

        return (bool) $s['sms_enabled'] && trim((string) $s['sms_gateway_url']) !== '';
    }

    /** 01XXXXXXXXX, or null when the number is not a Bangladeshi mobile. */
    public static function normalize(?string $mobile): ?string
    {
        $digits = preg_replace('/\D/', '', (string) Bn::toEnDigits($mobile));
        if (str_starts_with($digits, '880')) {
            $digits = substr($digits, 2);
        }

        return preg_match('/^01[3-9]\d{8}$/', $digits) ? $digits : null;
    }

    public function render(string $body, array $vars): string
    {
        $vars += ['society' => SettingService::get('society_name_bn')];

        return trim(preg_replace_callback('/\{(\w+)\}/', fn ($m) => array_key_exists($m[1], $vars) ? (string) $vars[$m[1]] : $m[0], $body));
    }

    /** Queue a templated message; silently skipped when the template is off or the number is unusable. */
    public function queue(string $templateKey, ?string $mobile, array $vars, ?Model $related = null): ?SmsLog
    {
        $template = SmsTemplate::where('key', $templateKey)->where('is_active', true)->first();
        $mobile = self::normalize($mobile);
        if (! $template || ! $mobile) {
            return null;
        }

        return $this->queueRaw($mobile, $this->render($template->body, $vars), $templateKey, $related);
    }

    public function queueRaw(string $mobile, string $message, ?string $templateKey = null, ?Model $related = null): SmsLog
    {
        return SmsLog::create([
            'template_key' => $templateKey, 'mobile' => $mobile, 'message' => $message, 'status' => 'pending',
            'related_type' => $related?->getMorphClass(), 'related_id' => $related?->getKey(), 'created_by' => auth()->id(),
        ]);
    }

    /** Try one message now. */
    public function send(SmsLog $log): SmsLog
    {
        if (! self::configured()) {
            $log->update(['status' => 'logged', 'response' => __('SMS গেটওয়ে চালু নেই — শুধু লগ রাখা হয়েছে।')]);

            return $log;
        }
        $s = SettingService::all();
        $log->increment('attempts');
        try {
            $url = $this->fillUrl((string) $s['sms_gateway_url'], $log, $s);
            $response = strtoupper((string) $s['sms_http_method']) === 'POST'
                ? $this->post($url)
                : Http::timeout(20)->get($url);
            $body = mb_substr(trim($response->body()), 0, 480);
            $keyword = trim((string) $s['sms_success_text']);
            $ok = $response->successful() && ($keyword === '' || mb_stripos($body, $keyword) !== false);
            $log->update([
                'status' => $ok ? 'sent' : ($log->attempts >= self::MAX_ATTEMPTS ? 'failed' : 'pending'),
                'response' => 'HTTP '.$response->status().' '.$body,
                'sent_at' => $ok ? now() : null,
            ]);
        } catch (Throwable $e) {
            $log->update([
                'status' => $log->attempts >= self::MAX_ATTEMPTS ? 'failed' : 'pending',
                'response' => mb_substr($e->getMessage(), 0, 480),
            ]);
        }

        return $log->fresh();
    }

    /** Drain the outbox (scheduler, every minute). */
    public function process(int $limit = 50): array
    {
        $done = ['sent' => 0, 'failed' => 0, 'logged' => 0, 'pending' => 0];
        SmsLog::where('status', 'pending')->where('attempts', '<', self::MAX_ATTEMPTS)->orderBy('id')->limit($limit)->get()
            ->each(function (SmsLog $log) use (&$done) {
                $done[$this->send($log)->status]++;
            });

        return $done;
    }

    /** Due reminders for irrigation bills and loan installments falling due in N days (run daily). */
    public function queueReminders(?string $today = null): int
    {
        if (! SettingService::get('sms_reminders')) {
            return 0;
        }
        $day = now()->parse($today ?? now()->toDateString())->addDays((int) SettingService::get('sms_reminder_days', 3))->toDateString();
        $count = 0;

        DB::table('invoices')->join('farmers', 'farmers.id', '=', 'invoices.farmer_id')->join('seasons', 'seasons.id', '=', 'invoices.season_id')
            ->whereIn('invoices.status', ['unpaid', 'partial'])->whereDate('invoices.due_date', $day)->whereNotNull('farmers.mobile')
            ->groupBy('farmers.id', 'farmers.name_bn', 'farmers.mobile', 'seasons.name_bn')
            ->selectRaw('farmers.id, farmers.name_bn, farmers.mobile, seasons.name_bn as season, SUM(invoices.amount - invoices.paid_amount) as due')
            ->get()->each(function ($r) use ($day, &$count) {
                if ($r->due > 0 && $this->queue('irrigation_due', $r->mobile, [
                    'name' => $r->name_bn, 'season' => $r->season, 'amount' => number_format((float) $r->due, 2), 'due_date' => date('d/m/Y', strtotime($day)),
                ])) {
                    $count++;
                }
            });

        // water bills falling due that day, one message per tap
        DB::table('water_bills')->join('water_connections', 'water_connections.id', '=', 'water_bills.connection_id')
            ->whereIn('water_bills.status', ['unpaid', 'partial'])->whereDate('water_bills.due_date', $day)->whereNotNull('water_connections.mobile')
            ->where('water_connections.status', '!=', 'closed')
            ->groupBy('water_connections.id', 'water_connections.name_bn', 'water_connections.mobile', 'water_connections.connection_no')
            ->selectRaw('water_connections.name_bn, water_connections.mobile, water_connections.connection_no,
                SUM(water_bills.amount + water_bills.penalty - water_bills.paid_amount) as due')
            ->get()->each(function ($r) use ($day, &$count) {
                if ($r->due > 0 && $this->queue('water_due', $r->mobile, [
                    'name' => $r->name_bn, 'connection_no' => $r->connection_no, 'amount' => number_format((float) $r->due, 2), 'due_date' => date('d/m/Y', strtotime($day)),
                ])) {
                    $count++;
                }
            });

        DB::table('loan_installments')->join('loans', 'loans.id', '=', 'loan_installments.loan_id')
            ->join('members', 'members.id', '=', 'loans.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
            ->where('loans.status', 'active')->whereDate('loan_installments.due_date', $day)->whereNotNull('farmers.mobile')
            ->selectRaw('loans.loan_no, farmers.name_bn, farmers.mobile, (loan_installments.principal + loan_installments.interest - loan_installments.principal_paid - loan_installments.interest_paid) as due')
            ->get()->each(function ($r) use ($day, &$count) {
                if ($r->due > 0 && $this->queue('loan_due', $r->mobile, [
                    'name' => $r->name_bn, 'loan_no' => $r->loan_no, 'amount' => number_format((float) $r->due, 2), 'due_date' => date('d/m/Y', strtotime($day)),
                ])) {
                    $count++;
                }
            });

        return $count;
    }

    /** Payment confirmation to the payer, when auto SMS is on. */
    public function paymentConfirmation(?string $mobile, string $name, float $amount, string $receiptNo, string $date, ?Model $related = null): void
    {
        if (SettingService::get('sms_auto_payment')) {
            $this->queue('payment', $mobile, [
                'name' => $name, 'amount' => number_format($amount, 2), 'receipt_no' => $receiptNo, 'date' => date('d/m/Y', strtotime($date)),
            ], $related);
        }
    }

    private function fillUrl(string $template, SmsLog $log, array $s): string
    {
        $vars = [
            'api_key' => (string) $s['sms_api_key'], 'sender_id' => (string) $s['sms_sender_id'],
            'mobile' => $log->mobile, 'mobile88' => '88'.$log->mobile, 'message' => $log->message,
        ];

        return preg_replace_callback('/\{(\w+)\}/', fn ($m) => array_key_exists($m[1], $vars) ? rawurlencode($vars[$m[1]]) : $m[0], $template);
    }

    private function post(string $url)
    {
        $parts = parse_url($url);
        parse_str($parts['query'] ?? '', $form);
        $base = ($parts['scheme'] ?? 'https').'://'.($parts['host'] ?? '').(isset($parts['port']) ? ':'.$parts['port'] : '').($parts['path'] ?? '');

        return Http::timeout(20)->asForm()->post($base, $form);
    }
}
