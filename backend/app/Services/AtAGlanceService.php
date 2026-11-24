<?php

namespace App\Services;

use App\Models\Account;
use App\Models\BankAccount;
use App\Models\Member;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * "এক নজরে" — the society at a glance for a reporting month, the sheet the
 * society sends upward: the facts kept by hand (sub-project, areas, families,
 * committee, meetings, trainings, dates) beside the figures the books give
 * (members, capital, withdrawals, dividends, banks, loans, service charge).
 * Men and women are counted from the farmer's gender.
 */
class AtAGlanceService
{
    /** Facts entered by hand in Settings, with their labels. */
    public const INFO = [
        'project_name' => 'উপ-প্রকল্পের নাম', 'sp_no' => 'এসপি নং', 'project_type' => 'ধরণ', 'upazila' => 'উপজেলা',
        'command_area' => 'মোট কমান্ডিং এলাকা (হেক্টর)', 'benefit_area' => 'উপকৃত এলাকা (হেক্টর)',
        'families_male' => 'মোট পরিবার — পুরুষ', 'families_female' => 'মোট পরিবার — মহিলা',
        'beneficiary_male' => 'উপকারভোগী পরিবার — পুরুষ', 'beneficiary_female' => 'উপকারভোগী পরিবার — মহিলা',
        'committee_male' => 'ব্যবস্থাপনা কমিটি — পুরুষ', 'committee_female' => 'ব্যবস্থাপনা কমিটি — মহিলা',
        'groups' => 'পানি ব্যবস্থাপনা গ্রুপ/ব্লক', 'agm_date' => 'বার্ষিক সাধারণ সভা', 'audit_date' => 'অডিট সম্পাদনের তারিখ',
        'committee_meetings' => 'ব্যবস্থাপনা কমিটির সভা (এই মাসে)', 'trainings' => 'পাবসস এর প্রশিক্ষণ সমূহ',
        'sub_committees' => 'পাবসস এর উপ-কমিটি সমূহ', 'handover_date' => 'উপ-প্রকল্প হস্তান্তরের তারিখ', 'election_date' => 'নির্বাচন',
    ];

    public static function info(): array
    {
        $raw = SettingService::get('at_a_glance');
        $v = is_array($raw) ? $raw : (json_decode((string) $raw, true) ?: []);

        return array_merge(array_fill_keys(array_keys(self::INFO), null), array_intersect_key($v, self::INFO));
    }

    /** @return array<string, mixed> */
    public function build(string $date): array
    {
        $to = CarbonImmutable::parse($date)->startOfDay();
        $from = $to->startOfMonth();
        $fyMonth = (int) (SettingService::get('fiscal_year_start_month', 7) ?: 7);
        $fy = $to->setDate($to->year, $fyMonth, 1);
        $fy = $fy->greaterThan($to) ? $fy->subYear() : $fy;
        [$d0, $d1, $f0] = [$from->toDateString(), $to->toDateString(), $fy->toDateString()];

        // men / women / total of a query that has the farmer joined as `farmers`
        $byGender = function ($q, string $sum = 'COUNT(*)') {
            $rows = (clone $q)->groupBy('farmers.gender')->selectRaw("farmers.gender as g, $sum as v")->pluck('v', 'g');

            return ['male' => (float) ($rows['male'] ?? 0), 'female' => (float) ($rows['female'] ?? 0), 'total' => (float) $rows->sum()];
        };
        $members = fn () => DB::table('members')->join('farmers', 'farmers.id', '=', 'members.farmer_id');

        $txn = fn (string $kind) => DB::table('member_transactions')->join('member_accounts', 'member_accounts.id', '=', 'member_transactions.member_account_id')
            ->where('member_accounts.kind', $kind)->where('member_transactions.status', 'posted');
        $sumTxn = fn ($q) => round((float) $q->sum('member_transactions.amount'), 2);

        $shareBalance = round((float) DB::table('member_accounts')->where('kind', 'share')->sum('balance'), 2);
        $savingsBalance = round((float) DB::table('member_accounts')->where('kind', 'savings')->sum('balance'), 2);
        $shareIn = $sumTxn($txn('share')->where('direction', 'in')->whereIn('type', ['purchase'])->whereBetween('member_transactions.date', [$d0, $d1]));
        $savingsIn = $sumTxn($txn('savings')->where('type', 'deposit')->whereBetween('member_transactions.date', [$d0, $d1]));
        $savingsOut = $sumTxn($txn('savings')->where('type', 'withdrawal')->whereBetween('member_transactions.date', [$d0, $d1]));
        $savingsOutAll = $sumTxn($txn('savings')->where('type', 'withdrawal')->where('member_transactions.date', '<=', $d1));
        $shareOut = $sumTxn($txn('share')->where('direction', 'out')->where('type', '!=', 'transfer_out')->whereBetween('member_transactions.date', [$d0, $d1]));

        $runs = fn () => DB::table('distribution_runs')->where('status', 'posted')->where('date', '<=', $d1);
        $loanRows = fn () => DB::table('loans')->join('members', 'members.id', '=', 'loans.member_id')->join('farmers', 'farmers.id', '=', 'members.farmer_id')
            ->whereNotNull('loans.disbursed_on');
        $payments = fn () => DB::table('loan_payments')->where('status', '!=', 'cancelled');
        $ledger = app(LedgerService::class);

        return [
            'date' => $d1, 'month_from' => $d0, 'fiscal_year_from' => $f0,
            'info' => self::info(),
            'society' => [
                'name' => SettingService::get('society_name_bn'), 'registration_no' => SettingService::get('registration_no'),
                'registration_date' => SettingService::get('registration_date'), 'address' => SettingService::get('print_address') ?: SettingService::get('address'),
            ],
            'villages' => DB::table('mouza_village')->distinct()->count('village_id'),
            'mouzas' => DB::table('mouzas')->count(),
            'members' => $byGender($members()->whereIn('members.status', [Member::ACTIVE, Member::INACTIVE])->where('members.admitted_on', '<=', $d1)),
            'new_members' => $byGender($members()->whereBetween('members.admitted_on', [$d0, $d1])),
            'cancelled_members' => $byGender(DB::table('membership_status_history')->join('members', 'members.id', '=', 'membership_status_history.member_id')
                ->join('farmers', 'farmers.id', '=', 'members.farmer_id')->where('membership_status_history.to_status', Member::CANCELLED)
                ->whereBetween('membership_status_history.effective_date', [$d0, $d1])),
            'capital' => ['share' => $shareBalance, 'savings' => $savingsBalance, 'total' => round($shareBalance + $savingsBalance, 2)],
            'capital_month' => ['share' => $shareIn, 'savings' => $savingsIn, 'total' => round($shareIn + $savingsIn, 2)],
            'savings_withdrawal' => ['month' => $savingsOut, 'total' => $savingsOutAll],
            'share_withdrawal_month' => $shareOut,
            'dividend' => [
                'year' => round((float) $runs()->where('date', '>=', $f0)->sum('total_amount'), 2),
                'share' => round((float) $runs()->where('date', '>=', $f0)->where('kind', 'dividend')->sum('total_amount'), 2),
                'savings' => round((float) $runs()->where('date', '>=', $f0)->where('kind', 'profit')->sum('total_amount'), 2),
                'total' => round((float) $runs()->sum('total_amount'), 2),
            ],
            'banks' => BankAccount::where('is_active', true)->orderBy('bank_name')->orderBy('id')->get()
                ->groupBy(fn ($b) => trim($b->bank_name.', '.($b->branch_name ?? ''), ', '))
                ->map(fn ($list, $bank) => ['bank' => $bank, 'accounts' => $list->map(fn ($b) => [
                    'account_no' => $b->account_no, 'type' => $b->account_type, 'balance' => round($ledger->balance($b->account_id, $d1), 2),
                ])->values()])->values(),
            'loans' => [
                'disbursed_total' => $byGender($loanRows()->where('loans.disbursed_on', '<=', $d1), 'SUM(loans.amount)'),
                'borrowers_total' => $byGender($loanRows()->where('loans.disbursed_on', '<=', $d1)),
                'collected_total' => round((float) $payments()->where('date', '<=', $d1)->sum('amount'), 2),
                'disbursed_month' => round((float) $loanRows()->whereBetween('loans.disbursed_on', [$d0, $d1])->sum('loans.amount'), 2),
                'borrowers_month' => $byGender($loanRows()->whereBetween('loans.disbursed_on', [$d0, $d1])),
                'collected_month' => round((float) $payments()->whereBetween('date', [$d0, $d1])->sum('amount'), 2),
                'collected_year' => round((float) $payments()->whereBetween('date', [$f0, $d1])->sum('amount'), 2),
                'outstanding' => round($ledger->balance(Account::byKey('loans_receivable')->id, $d1), 2),
                'service_charge_month' => round((float) $payments()->whereBetween('date', [$d0, $d1])->sum(DB::raw('interest + penalty')), 2),
                'service_charge_year' => round((float) $payments()->whereBetween('date', [$f0, $d1])->sum(DB::raw('interest + penalty')), 2),
            ],
        ];
    }
}
