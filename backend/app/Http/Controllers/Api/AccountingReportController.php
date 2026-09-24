<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Account;
use App\Models\AccountingPeriod;
use App\Models\Journal;
use App\Services\AccountingReportService;
use App\Services\AuditLogger;
use App\Services\FinancialYearService;
use App\Services\LedgerService;
use App\Support\CsvExport;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class AccountingReportController extends Controller
{
    public function __construct(private AccountingReportService $reports) {}

    /** General ledger; the cash book is the same view on a cash-stream account. */
    public function ledger(Request $request)
    {
        $data = $request->validate([
            'account_id' => ['required', 'exists:chart_of_accounts,id'],
            'from' => ['required', 'date'],
            'to' => ['required', 'date', 'after_or_equal:from'],
        ]);
        $account = Account::findOrFail($data['account_id']);
        $report = $this->reports->ledger($account, $data['from'], $data['to']);

        if ($request->query('export') === 'csv') {
            $name = app()->getLocale() === 'en' && $account->name_en ? $account->name_en : $account->name_bn;
            $rows = [[null, null, __('প্রারম্ভিক জের'), null, null, $report['opening']]];
            foreach ($report['rows'] as $r) {
                $rows[] = [$r['date'], $r['voucher_no'], $r['narration'], $r['debit'], $r['credit'], $r['balance']];
            }
            $rows[] = [null, null, __('সমাপনী জের'), $report['total_debit'], $report['total_credit'], $report['closing']];

            return CsvExport::download("ledger-{$account->code}.csv", [__('তারিখ'), __('ভাউচার নং'), __('বিবরণ').' ('.$name.')', __('ডেবিট'), __('ক্রেডিট'), __('জের')], $rows);
        }

        return response()->json($report);
    }

    public function trialBalance(Request $request)
    {
        $asOf = $request->validate(['as_of' => ['nullable', 'date']])['as_of'] ?? now()->toDateString();
        $report = $this->reports->trialBalance($asOf);

        if ($request->query('export') === 'csv') {
            $en = app()->getLocale() === 'en';
            $rows = $report['rows']->map(fn ($r) => [$r['code'], $en && $r['name_en'] ? $r['name_en'] : $r['name_bn'], $r['debit'], $r['credit']])->all();
            $rows[] = [null, __('মোট'), $report['total_debit'], $report['total_credit']];

            return CsvExport::download("trial-balance-{$asOf}.csv", [__('কোড'), __('হিসাব'), __('ডেবিট'), __('ক্রেডিট')], $rows);
        }

        return response()->json($report);
    }

    public function periods()
    {
        return response()->json(AccountingPeriod::with('closer:id,name_bn,name_en')
            ->withCount(['journals as posted_count' => fn ($q) => $q->whereIn('status', LedgerService::EFFECTIVE)])
            ->withCount(['journals as pending_count' => fn ($q) => $q->where('status', 'pending')])
            ->orderByDesc('period_key')->get());
    }

    /** Month-end lock: no entries may be dated inside a closed month. */
    public function closePeriod(Request $request, AccountingPeriod $period)
    {
        if ($period->status === 'closed') {
            throw ValidationException::withMessages(['period' => __('এই মাস ইতিমধ্যে বন্ধ।')]);
        }
        if (! $period->end_date->lt(today())) {
            throw ValidationException::withMessages(['period' => __('মাস শেষ হওয়ার আগে বন্ধ করা যাবে না।')]);
        }
        if (Journal::where('period_id', $period->id)->whereIn('status', ['pending', 'returned'])->exists()) {
            throw ValidationException::withMessages(['period' => __('এই মাসে অনুমোদনের অপেক্ষায় বা ফেরত আসা ভাউচার আছে; আগে নিষ্পত্তি করুন।')]);
        }
        $period->update(['status' => 'closed', 'closed_by' => $request->user()->id, 'closed_at' => now()]);

        return response()->json($period);
    }

    public function reopenPeriod(Request $request, AccountingPeriod $period)
    {
        $reason = $request->validate(['reason' => ['required', 'string', 'max:300']])['reason'];
        if ($period->status !== 'closed') {
            throw ValidationException::withMessages(['period' => __('এই মাস বন্ধ নয়।')]);
        }
        if (app(FinancialYearService::class)->isClosed($period->fiscal_year)) {
            throw ValidationException::withMessages(['period' => __('এই অর্থবছর চূড়ান্তভাবে বন্ধ; মাস খোলা যাবে না।')]);
        }
        $period->update(['status' => 'open', 'closed_by' => null, 'closed_at' => null]);
        AuditLogger::log('accounting', 'reopen', $period, null, null, $reason);

        return response()->json($period);
    }
}
