<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\IntegrityScan;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Home-page figures. Each block is shown only to users with the matching
 * permission; the society-wide numbers are cached for a few minutes (they
 * are totals over whole tables), per-user items are always fresh.
 */
class DashboardService
{
    public const TTL = 300;

    public const CHART_DAYS = 30;

    public function __construct(private AccountingReportService $reports, private LedgerService $ledger) {}

    public function forUser(User $user): array
    {
        $can = fn (string ...$perms) => collect($perms)->contains(fn ($p) => $user->can($p));
        $kpis = [];

        if ($can('farmer.view')) {
            $kpis[] = $this->kpi('farmers', __('কৃষক'), $this->cached('farmers', fn () => DB::table('farmers')->whereNull('deleted_at')->whereNull('merged_into_id')->count()), 'number', '/farmers');
        }
        if ($can('member.view')) {
            $kpis[] = $this->kpi('members', __('সক্রিয় সদস্য'), $this->cached('members', fn () => DB::table('members')->where('status', 'active')->count()), 'number', '/members');
        }
        if ($can('land.view')) {
            $land = $this->cached('lands', fn () => (array) DB::table('lands')->whereNull('deleted_at')->selectRaw('count(*) as n, coalesce(sum(area_decimal),0) as area')->first());
            $kpis[] = $this->kpi('lands', __('জমি'), (int) $land['n'], 'number', '/lands', __(':a শতক', ['a' => number_format((float) $land['area'], 2)]));
        }
        if ($can('irrigation.view')) {
            $kpis[] = $this->kpi('irrigation_due', __('সেচের বকেয়া'), $this->cached('irrigation_due', fn () => round((float) DB::table('invoices')
                ->whereIn('status', ['unpaid', 'partial'])->sum(DB::raw('amount - paid_amount')), 2)), 'money', '/irrigation/dues');
        }
        foreach (['savings' => __('মোট সঞ্চয়'), 'share' => __('মোট শেয়ার')] as $kind => $label) {
            if ($can($kind.'.view')) {
                $kpis[] = $this->kpi($kind, $label, $this->cached($kind, fn () => round((float) DB::table('member_accounts')->where('kind', $kind)->sum('balance'), 2)), 'money', '/funds/'.$kind.'/accounts');
            }
        }
        if ($can('loan.view')) {
            $loan = $this->cached('loans', fn () => $this->loanFigures());
            $kpis[] = $this->kpi('loan_outstanding', __('বকেয়া ঋণ (আসল)'), $loan['outstanding'], 'money', '/loans', __(':n টি চলমান ঋণ', ['n' => $loan['active']]));
            $kpis[] = $this->kpi('loan_overdue', __('মেয়াদোত্তীর্ণ কিস্তি'), $loan['overdue'], 'money', '/loans/dues', __(':n টি ঋণ', ['n' => $loan['overdue_loans']]), $loan['overdue'] > 0 ? 'warning' : null);
        }
        if ($can('cash.view', 'bank.view')) {
            $kpis[] = $this->kpi('cash', __('হাতে নগদ'), $this->cached('cash', fn () => round(Account::whereIn('key', Account::CASH_STREAMS)->get()
                ->sum(fn ($a) => $this->ledger->balance($a->id)), 2)), 'money', '/accounting/funds');
            $kpis[] = $this->kpi('bank', __('ব্যাংকে জমা'), $this->cached('bank', fn () => round(Account::whereHas('bankAccount')->get()
                ->sum(fn ($a) => $this->ledger->balance($a->id)), 2)), 'money', '/accounting/bank-accounts');
        }

        $out = ['kpis' => $kpis, 'pending' => $this->pending($user, $can), 'alerts' => $this->alerts($can), 'generated_at' => now()->toDateTimeString()];

        if ($can('payment.view')) {
            $out['collection'] = $this->cached('collection', fn () => $this->collection());
            $out['recent'] = $this->recent();
        }

        return $out;
    }

    /** Drop the cached totals, e.g. after a big import. */
    public static function flush(): void
    {
        foreach (['farmers', 'members', 'lands', 'irrigation_due', 'savings', 'share', 'loans', 'cash', 'bank', 'collection'] as $k) {
            foreach (['bn', 'en'] as $l) {
                Cache::forget("dashboard:$k:$l");
            }
        }
    }

    private function cached(string $key, callable $fn): mixed
    {
        return Cache::remember('dashboard:'.$key.':'.app()->getLocale(), self::TTL, $fn);
    }

    private function kpi(string $key, string $label, float|int $value, string $type, string $link, ?string $hint = null, ?string $tone = null): array
    {
        return compact('key', 'label', 'value', 'type', 'link', 'hint', 'tone');
    }

    private function loanFigures(): array
    {
        $live = DB::table('loans')->where('status', 'active')->whereNotNull('journal_id');
        $principal = (float) (clone $live)->sum('amount');
        $paid = (float) DB::table('loan_installments')->whereIn('loan_id', (clone $live)->select('id'))->sum('principal_paid');
        $overdue = DB::table('loan_installments')->whereIn('loan_id', (clone $live)->select('id'))->where('due_date', '<', today()->toDateString())
            ->whereRaw('(principal + interest) - (principal_paid + interest_paid) > 0.009')
            ->selectRaw('count(distinct loan_id) as loans, coalesce(sum((principal + interest) - (principal_paid + interest_paid)),0) as amount')->first();

        return ['active' => (clone $live)->count(), 'outstanding' => round($principal - $paid, 2),
            'overdue' => round((float) $overdue->amount, 2), 'overdue_loans' => (int) $overdue->loans];
    }

    /** Daily money received into cash/bank for the last CHART_DAYS days, per module, plus today / this month. */
    private function collection(): array
    {
        $to = today();
        $from = $to->copy()->subDays(self::CHART_DAYS - 1);
        $byDay = $this->reports->collectionsByDay($from->toDateString(), $to->toDateString());
        $modules = collect($byDay)->flatMap(fn ($m) => array_keys($m))->unique()->values();
        $labels = config('erp.modules');
        $days = [];
        for ($d = $from->copy(); $d->lte($to); $d->addDay()) {
            $row = ['date' => $d->toDateString(), 'total' => 0.0];
            foreach ($modules as $m) {
                $row[$m] = round((float) ($byDay[$d->toDateString()][$m] ?? 0), 2);
                $row['total'] += $row[$m];
            }
            $row['total'] = round($row['total'], 2);
            $days[] = $row;
        }
        $month = collect($this->reports->collectionsByDay($to->copy()->startOfMonth()->toDateString(), $to->toDateString()))
            ->sum(fn ($m) => array_sum($m));

        return [
            'days' => $days,
            'modules' => $modules->map(fn ($m) => ['key' => $m, 'label' => __($labels[$m] ?? 'অন্যান্য')])->values(),
            'today' => end($days)['total'] ?? 0.0, 'month' => round($month, 2),
        ];
    }

    private function recent(): array
    {
        $receipts = DB::table('receipts')->leftJoin('users', 'users.id', '=', 'receipts.created_by')->orderByDesc('receipts.id')->limit(8)
            ->get(['receipts.id', 'receipts.receipt_no as no', 'receipts.date', 'receipts.payer_name as payer', 'receipts.amount', 'receipts.module', 'receipts.status', 'users.name_bn', 'users.name_en', 'receipts.created_at'])
            ->map(fn ($r) => (array) $r + ['kind' => 'receipt', 'link' => '/payments/receipts/'.$r->id]);
        $combined = DB::table('combined_payments')->leftJoin('users', 'users.id', '=', 'combined_payments.created_by')->orderByDesc('combined_payments.id')->limit(8)
            ->get(['combined_payments.id', 'combined_payments.payment_no as no', 'combined_payments.date', 'combined_payments.payer_name as payer', 'combined_payments.amount',
                DB::raw("'combined' as module"), 'combined_payments.status', 'users.name_bn', 'users.name_en', 'combined_payments.created_at'])
            ->map(fn ($r) => (array) $r + ['kind' => 'combined', 'link' => '/payments/combined/'.$r->id]);
        $labels = config('erp.modules');

        return $receipts->concat($combined)->sortByDesc('created_at')->take(10)->map(function ($r) use ($labels) {
            $r['module_label'] = $r['module'] === 'combined' ? __('সমন্বিত রশিদ') : __($labels[$r['module']] ?? $r['module']);
            $r['amount'] = (float) $r['amount'];
            $r['by'] = app()->getLocale() === 'en' && $r['name_en'] ? $r['name_en'] : $r['name_bn'];
            unset($r['name_bn'], $r['name_en']);

            return $r;
        })->values()->all();
    }

    private function pending(User $user, callable $can): array
    {
        $q = ApprovalRequest::where('requested_by', '!=', $user->id);
        $q = $user->isSuperAdmin() ? $q->where('status', ApprovalRequest::PENDING) : $q->awaitingRoles($user->getRoleNames()->all());
        $items = [['key' => 'approvals', 'label' => __('আমার অনুমোদনের অপেক্ষায়'), 'count' => $q->count(), 'link' => '/approvals']];
        if ($can('payment.view')) {
            $items[] = ['key' => 'public_payments', 'label' => __('যাচাইয়ের অপেক্ষায় অনলাইন পেমেন্ট'),
                'count' => DB::table('public_payment_requests')->where('status', 'pending')->count(), 'link' => '/accounting/public-payments'];
        }
        if ($can('membership.view')) {
            $items[] = ['key' => 'applications', 'label' => __('অপেক্ষমাণ সদস্যপদ আবেদন'),
                'count' => DB::table('membership_applications')->where('status', 'pending')->count(), 'link' => '/membership/applications'];
        }

        return $items;
    }

    /** Things that need attention: failed scans, stale backup, unclosed days, failed SMS. */
    private function alerts(callable $can): array
    {
        $alerts = [];
        if ($can('audit.view')) {
            $scan = IntegrityScan::latest('id')->first();
            if ($scan && $scan->errors > 0) {
                $alerts[] = ['type' => 'error', 'message' => __('সর্বশেষ ডেটা স্ক্যানে :n টি গুরুতর অসঙ্গতি পাওয়া গেছে।', ['n' => $scan->errors]), 'link' => '/audit/integrity-scan'];
            } elseif (! $scan || $scan->created_at->lt(now()->subDays(2))) {
                $alerts[] = ['type' => 'info', 'message' => __('দুই দিনের মধ্যে ডেটা সঠিকতা স্ক্যান চালানো হয়নি।'), 'link' => '/audit/integrity-scan'];
            }
        }
        if ($can('backup.view')) {
            $last = DB::table('backups')->max('created_at');
            if (! $last || Carbon::parse($last)->lt(now()->subDays(2))) {
                $alerts[] = ['type' => 'warning', 'message' => __('দুই দিনের বেশি সময় ধরে কোনো ব্যাকআপ নেওয়া হয়নি।'), 'link' => '/admin/backups'];
            }
        }
        if ($can('cash.view')) {
            $yesterday = today()->subDay()->toDateString();
            $hadCash = DB::table('journals')->where('date', $yesterday)->whereIn('status', LedgerService::EFFECTIVE)->exists();
            if ($hadCash && ! DB::table('day_closes')->where('date', $yesterday)->exists()) {
                $alerts[] = ['type' => 'warning', 'message' => __('গতকালের দিন সমাপনী (ক্যাশ মিলানো) করা হয়নি।'), 'link' => '/cash/day-close'];
            }
        }
        if ($can('sms.view')) {
            $failed = DB::table('sms_logs')->where('status', 'failed')->where('created_at', '>=', now()->subDay())->count();
            if ($failed) {
                $alerts[] = ['type' => 'warning', 'message' => __('গত ২৪ ঘণ্টায় :n টি SMS পাঠানো যায়নি।', ['n' => $failed]), 'link' => '/settings/sms-logs'];
            }
        }

        return $alerts;
    }
}
