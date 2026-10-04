<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\Asset;
use App\Models\IntegrityScan;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Home-page figures. Each block is shown only to users with the matching
 * permission; the society-wide numbers are cached for a few minutes (they
 * are totals over whole tables), per-user items are always fresh.
 *
 * Every KPI carries `change`: % difference against the end of last month
 * (season figures: against the previous season), null when there is nothing
 * to compare with.
 */
class DashboardService
{
    public const TTL = 300;

    public const CHART_DAYS = 40;

    /** Chart / tag order of the collection modules; anything else follows. */
    public const MODULE_ORDER = ['irrigation', 'water', 'savings', 'loan', 'share'];

    private const CACHE_KEYS = ['people', 'lands', 'season', 'irrigation_due', 'savings', 'share', 'loans', 'cash', 'bank', 'assets', 'collection', 'notices'];

    public function __construct(private AccountingReportService $reports, private LedgerService $ledger) {}

    public function forUser(User $user): array
    {
        $can = fn (string ...$perms) => collect($perms)->contains(fn ($p) => $user->can($p));
        $vsMonth = __('গত মাসের তুলনায়');
        $kpis = [];

        if ($can('farmer.view', 'member.view')) {
            $p = $this->cached('people', fn () => $this->people());
            if ($can('farmer.view')) {
                $kpis[] = $this->kpi('farmers', __('মোট কৃষক'), $p['farmers'], 'number', '/farmers', $vsMonth, $this->pct($p['farmers'], $p['farmers_prev']));
            }
            if ($can('member.view')) {
                $kpis[] = $this->kpi('member_farmers', __('সদস্য কৃষক'), $p['members'], 'number', '/members', $vsMonth, $this->pct($p['members'], $p['members_prev']));
            }
            if ($can('farmer.view')) {
                $kpis[] = $this->kpi('non_member_farmers', __('অ-সদস্য কৃষক'), $p['non_members'], 'number', '/farmers?type=non_member', $vsMonth, $this->pct($p['non_members'], $p['non_members_prev']));
            }
        }
        if ($can('land.view')) {
            $land = $this->cached('lands', fn () => $this->lands());
            $kpis[] = $this->kpi('land', __('মোট জমি'), $land['acre'], 'decimal', '/lands', __('একর'), $this->pct($land['acre'], $land['acre_prev']));
        }

        $season = null;
        if ($can('irrigation.view')) {
            $season = $this->cached('season', fn () => $this->season());
            $cur = $season['current'];
            $prev = $season['previous'];
            $caption = __('এই মৌসুম');
            $kpis[] = $this->kpi('irrigation_invoices', __('সেচ ইনভয়েস'), $cur['invoices'], 'number', '/irrigation/invoices', $caption, $prev ? $this->pct($cur['invoices'], $prev['invoices']) : null);
            $kpis[] = $this->kpi('irrigation_collection', __('সেচ আদায়'), $cur['collected'], 'money', '/reports/collections', $caption, $prev ? $this->pct($cur['collected'], $prev['collected']) : null);
            $due = $this->cached('irrigation_due', fn () => [
                'value' => round((float) DB::table('invoices')->whereIn('status', ['unpaid', 'partial'])->sum(DB::raw('amount - paid_amount')), 2),
                'change' => $this->ledgerChange('irrigation_receivable', 1),
            ]);
            $kpis[] = $this->kpi('irrigation_due', __('সেচের বকেয়া'), $due['value'], 'money', '/irrigation/dues', null, $due['change']);
        }
        if ($can('water.view')) {
            $w = $this->cached('water', fn () => $this->waterFigures() + ['change' => $this->ledgerChange('water_receivable', 1)]);
            $kpis[] = $this->kpi('water_collection', __('পানির বিল আদায়'), $w['collected'], 'money', '/water/receipts', __('এই মাস'), $this->pct($w['collected'], $w['collected_prev']));
            $kpis[] = $this->kpi('water_due', __('পানির বিল বকেয়া'), $w['due'], 'money', '/water/dues', __(':n সংযোগ', ['n' => $w['owing']]), $w['change']);
        }
        foreach (['savings' => [__('মোট সঞ্চয়'), __('সব সদস্য')], 'share' => [__('শেয়ার মূলধন'), __('মোট')]] as $kind => [$label, $caption]) {
            if ($can($kind.'.view')) {
                $f = $this->cached($kind, fn () => [
                    'value' => round((float) DB::table('member_accounts')->where('kind', $kind)->sum('balance'), 2),
                    'change' => $this->ledgerChange($kind === 'savings' ? 'savings_deposits' : 'share_capital', -1),
                ]);
                $kpis[] = $this->kpi($kind, $label, $f['value'], 'money', '/funds/'.$kind.'/accounts', $caption, $f['change']);
            }
        }
        $loan = null;
        if ($can('loan.view')) {
            $loan = $this->cached('loans', fn () => $this->loanFigures() + ['change' => $this->ledgerChange('loans_receivable', 1)]);
            $kpis[] = $this->kpi('loans', __('মোট ঋণ'), $loan['outstanding'], 'money', '/loans', __('বকেয়া'), $loan['change']);
        }
        // keep the sample's card order: savings before loans, share after loans
        $kpis = $this->reorder($kpis, ['farmers', 'member_farmers', 'non_member_farmers', 'land', 'irrigation_invoices', 'irrigation_collection', 'irrigation_due', 'water_collection', 'water_due', 'savings', 'loans', 'share']);

        if ($can('cash.view', 'bank.view')) {
            $kpis[] = $this->kpi('cash', __('হাতে নগদ'), $this->cached('cash', fn () => round(Account::whereIn('key', Account::CASH_STREAMS)->get()
                ->sum(fn ($a) => $this->ledger->balance($a->id)), 2)), 'money', '/accounting/funds');
            $kpis[] = $this->kpi('bank', __('ব্যাংক জমা'), $this->cached('bank', fn () => round(Account::whereHas('bankAccount')->get()
                ->sum(fn ($a) => $this->ledger->balance($a->id)), 2)), 'money', '/accounting/bank-accounts');
        }
        if ($can('asset.view')) {
            $kpis[] = $this->kpi('assets', __('মোট সম্পদ'), $this->cached('assets', fn () => round((float) DB::table('assets')
                ->whereNotIn('status', Asset::GONE)->sum(DB::raw('cost - accumulated_depreciation')), 2)), 'money', '/assets/dashboard');
        }

        $out = [
            'kpis' => $kpis,
            'pending' => $this->pending($user, $can),
            'approvals' => $this->approvals($user),
            'notices' => $this->notices($can, $loan),
            'alerts' => $this->alerts($can),
            'generated_at' => now()->toDateTimeString(),
        ];
        if ($season) {
            $out['season'] = $season['current'];
        }
        if ($can('payment.view')) {
            $out['collection'] = $this->cached('collection', fn () => $this->collection());
            $out['recent'] = $this->recent();
        }

        return $out;
    }

    /** Drop the cached totals, e.g. after a big import. */
    public static function flush(): void
    {
        foreach (self::CACHE_KEYS as $k) {
            foreach (['bn', 'en'] as $l) {
                Cache::forget("dashboard:$k:$l");
            }
        }
    }

    private function cached(string $key, callable $fn): mixed
    {
        return Cache::remember('dashboard:'.$key.':'.app()->getLocale(), self::TTL, $fn);
    }

    private function kpi(string $key, string $label, float|int $value, string $type, string $link, ?string $caption = null, ?float $change = null): array
    {
        return compact('key', 'label', 'value', 'type', 'link', 'caption', 'change');
    }

    private function reorder(array $kpis, array $order): array
    {
        usort($kpis, fn ($a, $b) => array_search($a['key'], $order, true) <=> array_search($b['key'], $order, true));

        return $kpis;
    }

    private function pct(float|int $now, float|int $prev): ?float
    {
        return abs($prev) < 0.005 ? null : round(($now - $prev) / abs($prev) * 100, 1);
    }

    private function lastMonthEnd(): Carbon
    {
        return today()->startOfMonth()->subDay();
    }

    /** % change of a ledger account's balance since the end of last month; $sign -1 for credit-side accounts. */
    private function ledgerChange(string $key, int $sign): ?float
    {
        $account = Account::where('key', $key)->first();
        if (! $account) {
            return null;
        }

        return $this->pct($sign * $this->ledger->balance($account->id), $sign * $this->ledger->balance($account->id, $this->lastMonthEnd()->toDateString()));
    }

    private function people(): array
    {
        $end = $this->lastMonthEnd()->endOfDay();
        $farmers = DB::table('farmers')->whereNull('deleted_at')->whereNull('merged_into_id');
        $members = DB::table('members')->where('status', 'active');

        return [
            'farmers' => (clone $farmers)->count(),
            'farmers_prev' => (clone $farmers)->where('created_at', '<=', $end)->count(),
            'members' => (clone $members)->count(),
            'members_prev' => (clone $members)->where('admitted_on', '<=', $end->toDateString())->count(),
            // same rule as the farmer list's "non-member" filter: no membership record at all
            'non_members' => (clone $farmers)->whereNotExists(fn ($q) => $q->from('members')->whereColumn('members.farmer_id', 'farmers.id'))->count(),
            'non_members_prev' => (clone $farmers)->where('created_at', '<=', $end)
                ->whereNotExists(fn ($q) => $q->from('members')->whereColumn('members.farmer_id', 'farmers.id')->where('admitted_on', '<=', $end->toDateString()))->count(),
        ];
    }

    /** Land area in acres (100 শতক = 1 acre). */
    private function lands(): array
    {
        $q = DB::table('lands')->whereNull('deleted_at');

        return [
            'acre' => round((float) (clone $q)->sum('area_decimal') / 100, 2),
            'acre_prev' => round((float) (clone $q)->where('created_at', '<=', $this->lastMonthEnd()->endOfDay())->sum('area_decimal') / 100, 2),
        ];
    }

    /** The running season (latest open one, else the latest) and the one before it. */
    private function season(): array
    {
        $current = DB::table('seasons')->where('status', 'open')->orderByDesc('start_date')->first()
            ?? DB::table('seasons')->orderByDesc('start_date')->first();
        $previous = $current ? DB::table('seasons')->where('start_date', '<', $current->start_date)->orderByDesc('start_date')->first() : null;

        return ['current' => $this->seasonFigures($current), 'previous' => $previous ? $this->seasonFigures($previous) : null];
    }

    private function seasonFigures(?object $season): array
    {
        $row = $season ? DB::table('invoices')->where('season_id', $season->id)->where('status', '!=', 'cancelled')
            ->selectRaw('count(*) as n, coalesce(sum(amount),0) as amount, coalesce(sum(paid_amount),0) as paid')->first() : null;
        $amount = round((float) ($row->amount ?? 0), 2);
        $paid = round((float) ($row->paid ?? 0), 2);

        return [
            'id' => $season?->id,
            'name' => $season ? (app()->getLocale() === 'en' && ($season->name_en ?? null) ? $season->name_en : $season->name_bn) : null,
            'invoices' => (int) ($row->n ?? 0),
            'amount' => $amount,
            'collected' => $paid,
            'due' => round($amount - $paid, 2),
        ];
    }

    private function loanFigures(): array
    {
        $live = DB::table('loans')->where('status', 'active')->whereNotNull('journal_id');
        $principal = (float) (clone $live)->sum('amount');
        $paid = (float) DB::table('loan_installments')->whereIn('loan_id', (clone $live)->select('id'))->sum('principal_paid');
        $overdue = DB::table('loan_installments')->whereIn('loan_id', (clone $live)->select('id'))->where('due_date', '<', today()->toDateString())
            ->whereRaw('(principal + interest) - (principal_paid + interest_paid) > 0.009')
            ->selectRaw('count(*) as installments, count(distinct loan_id) as loans, coalesce(sum((principal + interest) - (principal_paid + interest_paid)),0) as amount')->first();

        return ['active' => (clone $live)->count(), 'outstanding' => round($principal - $paid, 2),
            'overdue' => round((float) $overdue->amount, 2), 'overdue_loans' => (int) $overdue->loans, 'overdue_installments' => (int) $overdue->installments];
    }

    /** Daily money received into cash/bank for the last CHART_DAYS days, per module, plus today / this month. */
    /** Water receipts this month and last (cancelled ones left out), and what is still owed on water bills. */
    private function waterFigures(): array
    {
        $sum = fn (string $from, string $to) => round((float) DB::table('receipts')->where('module', 'water')->where('status', '!=', 'cancelled')
            ->whereBetween('date', [$from, $to])->sum('amount'), 2);
        $month = today()->startOfMonth();
        $open = DB::table('water_bills')->whereIn('status', ['unpaid', 'partial']);

        return [
            'collected' => $sum($month->toDateString(), today()->toDateString()),
            // the same days of last month, so early in a month the comparison is fair
            'collected_prev' => $sum($month->copy()->subMonthNoOverflow()->toDateString(), today()->subMonthNoOverflow()->toDateString()),
            'due' => round((float) (clone $open)->sum(DB::raw('amount + penalty - paid_amount')), 2),
            'owing' => (clone $open)->distinct()->count('connection_id'),
        ];
    }

    private function collection(): array
    {
        $to = today();
        $from = $to->copy()->subDays(self::CHART_DAYS - 1);
        $byDay = $this->reports->collectionsByDay($from->toDateString(), $to->toDateString());
        $found = collect($byDay)->flatMap(fn ($m) => array_keys($m))->unique();
        $modules = collect(self::MODULE_ORDER)->concat($found->diff(self::MODULE_ORDER)->sort())->values();
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
        $receipts = DB::table('receipts')->leftJoin('users', 'users.id', '=', 'receipts.created_by')->orderByDesc('receipts.id')->limit(6)
            ->get(['receipts.id', 'receipts.receipt_no as no', 'receipts.date', 'receipts.payer_name as payer', 'receipts.amount', 'receipts.module', 'receipts.status', 'users.name_bn', 'users.name_en', 'receipts.created_at'])
            ->map(fn ($r) => (array) $r + ['kind' => 'receipt', 'link' => '/payments/receipts/'.$r->id]);
        $combined = DB::table('combined_payments')->leftJoin('users', 'users.id', '=', 'combined_payments.created_by')->orderByDesc('combined_payments.id')->limit(6)
            ->get(['combined_payments.id', 'combined_payments.payment_no as no', 'combined_payments.date', 'combined_payments.payer_name as payer', 'combined_payments.amount',
                DB::raw("'combined' as module"), 'combined_payments.status', 'users.name_bn', 'users.name_en', 'combined_payments.created_at'])
            ->map(fn ($r) => (array) $r + ['kind' => 'combined', 'link' => '/payments/combined/'.$r->id]);
        $labels = config('erp.modules');

        return $receipts->concat($combined)->sortByDesc('created_at')->take(5)->map(function ($r) use ($labels) {
            $r['module_label'] = $r['module'] === 'combined' ? __('সমন্বিত রশিদ') : __($labels[$r['module']] ?? $r['module']);
            $r['amount'] = (float) $r['amount'];
            $r['by'] = app()->getLocale() === 'en' && $r['name_en'] ? $r['name_en'] : $r['name_bn'];
            unset($r['name_bn'], $r['name_en']);

            return $r;
        })->values()->all();
    }

    private function awaiting(User $user)
    {
        $q = ApprovalRequest::where('requested_by', '!=', $user->id);

        return $user->isSuperAdmin() ? $q->where('status', ApprovalRequest::PENDING) : $q->awaitingRoles($user->getRoleNames()->all());
    }

    private function pending(User $user, callable $can): array
    {
        $items = [['key' => 'approvals', 'label' => __('আমার অনুমোদনের অপেক্ষায়'), 'count' => $this->awaiting($user)->count(), 'link' => '/approvals']];
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

    /** The latest requests waiting for this user's decision. */
    private function approvals(User $user): array
    {
        $labels = config('erp.modules');

        return $this->awaiting($user)->with('requester:id,name_bn,name_en')->latest('id')->limit(5)->get()
            ->map(fn (ApprovalRequest $r) => [
                'id' => $r->id,
                'date' => $r->created_at?->toDateString(),
                'type' => __($labels[$r->module] ?? $r->module),
                'title' => $r->title,
                'applicant' => $r->requester ? (app()->getLocale() === 'en' && $r->requester->name_en ? $r->requester->name_en : $r->requester->name_bn) : null,
                'link' => '/approvals/'.$r->id,
            ])->all();
    }

    /** Counted to-do items for the "Important alerts" card. */
    private function notices(callable $can, ?array $loan): array
    {
        $counts = $this->cached('notices', function () {
            $cutoff = today()->subDays(30)->toDateString();
            $period = today()->subMonthNoOverflow()->format('Y-m');

            return [
                'irrigation_due_30' => DB::table('invoices')->whereIn('status', ['unpaid', 'partial'])
                    ->whereRaw('coalesce(due_date, invoice_date) < ?', [$cutoff])->count(),
                'membership' => DB::table('membership_applications')->where('status', 'pending')->count(),
                'withdrawals' => DB::table('member_transactions')->where('kind', 'savings')->where('type', 'withdrawal')->where('status', 'pending')->count(),
                'bank_recon' => DB::table('bank_accounts')->where('is_active', true)->whereNotExists(fn ($q) => $q->from('bank_reconciliations')
                    ->whereColumn('bank_reconciliations.bank_account_id', 'bank_accounts.id')->where('period', $period)->where('status', 'finalized'))->count(),
                'maintenance' => DB::table('asset_maintenances')->where('status', 'scheduled')->whereNotNull('due_on')
                    ->where('due_on', '<=', today()->toDateString())->count(),
                // taps with two or more months' bills unpaid: the disconnection list
                'water_owing' => DB::table('water_bills')->whereIn('status', ['unpaid', 'partial'])->where('kind', 'monthly')
                    ->groupBy('connection_id')->havingRaw('COUNT(*) >= 2')->select('connection_id')->get()->count(),
            ];
        });
        $rows = [];
        $add = function (string $key, string $label, int $count, string $tone, string $link) use (&$rows) {
            $rows[] = compact('key', 'label', 'count', 'tone', 'link');
        };
        if ($can('irrigation.view')) {
            $add('irrigation_due_30', __('৩০ দিনের বেশি সেচের বকেয়া'), $counts['irrigation_due_30'], 'error', '/irrigation/dues');
        }
        if ($can('water.view')) {
            $add('water_owing', __('২ মাস বা বেশি পানির বিল বকেয়া (সংযোগ)'), $counts['water_owing'], 'warning', '/water/dues');
        }
        if ($loan) {
            $add('loan_overdue', __('ঋণের কিস্তি মেয়াদোত্তীর্ণ'), $loan['overdue_installments'] ?? $loan['overdue_loans'], 'warning', '/loans/dues');
        }
        if ($can('membership.view')) {
            $add('membership', __('সদস্যপদ আবেদন অপেক্ষমাণ'), $counts['membership'], 'warning', '/membership/applications');
        }
        if ($can('savings.view')) {
            $add('withdrawals', __('সঞ্চয় উত্তোলনের অনুরোধ অপেক্ষমাণ'), $counts['withdrawals'], 'info', '/funds/savings/transactions');
        }
        if ($can('bank.view')) {
            $add('bank_recon', __('ব্যাংক মিলকরণ বাকি'), $counts['bank_recon'], 'error', '/accounting/bank-reconciliations');
        }
        if ($can('asset.view')) {
            $add('maintenance', __('সম্পদ রক্ষণাবেক্ষণ বাকি'), $counts['maintenance'], 'info', '/assets/maintenances');
        }

        return $rows;
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
