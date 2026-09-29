<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\Farmer;
use App\Models\ImportBatch;
use App\Models\Invoice;
use App\Models\Land;
use App\Models\Loan;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Models\MemberTransaction;
use App\Models\Receipt;
use App\Models\ReceiptItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Undoes an import batch — only while nothing has been built on top of it
 * (a later transaction, receipt, invoice or reference). A rollback needs
 * admin approval; money is reversed through the ledger, never deleted.
 */
class ImportRollbackService
{
    /** Tables that make an imported farmer "used" (column => tables). */
    private const FARMER_REFS = [
        'farmer_id' => ['land_owners', 'land_cultivations', 'invoices', 'receipts', 'membership_applications', 'combined_payments', 'public_payment_requests'],
        'merged_into_id' => ['farmers'],
    ];

    // Savings/share accounts open by themselves with the membership, so an
    // empty one does not count as use; one with transactions does.
    private const MEMBER_REFS = ['loans', 'loan_guarantors', 'voter_list_items', 'distribution_items'];

    public function __construct(
        private ApprovalService $approvals,
        private LedgerService $ledger,
        private MemberFundService $funds,
        private ReceiptService $receipts,
    ) {}

    /** @return list<string> reasons the batch can't be rolled back (at most 20) */
    public function blockers(ImportBatch $batch): array
    {
        if ($batch->status === 'rolled_back') {
            return [__('এই ব্যাচ আগেই রোলব্যাক হয়েছে।')];
        }
        $out = match ($batch->type) {
            'farmers' => $this->farmerBlockers($batch),
            'lands' => $this->landBlockers($batch),
            'savings_opening', 'share_opening' => $this->openingBlockers($batch),
            'loan_opening' => $this->loanBlockers($batch),
            'legacy_irrigation' => $this->invoiceBlockers($batch),
            'payments' => $this->paymentBlockers($batch),
            default => [__('অজানা ইমপোর্ট ধরন')],
        };

        return array_slice($out, 0, 20);
    }

    public function requestRollback(ImportBatch $batch, string $reason): ApprovalRequest
    {
        if ($batch->status !== 'completed') {
            throw ValidationException::withMessages(['reason' => $batch->status === 'rolled_back'
                ? __('এই ব্যাচ আগেই রোলব্যাক হয়েছে।') : __('এই ব্যাচের রোলব্যাক অনুমোদনের অপেক্ষায় আছে।')]);
        }
        if ($blockers = $this->blockers($batch)) {
            throw ValidationException::withMessages(['reason' => array_merge([__('রোলব্যাক করা যাবে না:')], $blockers)]);
        }

        return DB::transaction(function () use ($batch, $reason) {
            $batch->update(['status' => 'rollback_pending', 'rollback_reason' => $reason]);
            $request = $this->approvals->submit(
                'import.rollback',
                __('ইমপোর্ট রোলব্যাক: ব্যাচ #:id', ['id' => $batch->id]),
                $batch,
                ['ব্যাচ' => '#'.$batch->id, 'ধরন' => __(ImportService::TYPES[$batch->type][0] ?? $batch->type), 'ফাইল' => $batch->filename,
                    'সারি' => $batch->imported_rows, 'টাকা' => (float) $batch->total_amount, 'কারণ' => $reason],
                null,
                (float) $batch->total_amount ?: null,
            );
            $batch->update(['approval_request_id' => $request->id]);

            return $request;
        });
    }

    /** Approval handler: re-check and undo everything the batch created. */
    public function rollback(ImportBatch $batch): void
    {
        DB::transaction(function () use ($batch) {
            $batch = ImportBatch::whereKey($batch->id)->lockForUpdate()->firstOrFail();
            if ($batch->status === 'rolled_back') {
                return;
            }
            if ($blockers = $this->blockers($batch)) {
                throw ValidationException::withMessages(['reason' => array_merge([__('রোলব্যাক করা যাবে না:')], $blockers)]);
            }
            $reason = __('ইমপোর্ট ব্যাচ #:id রোলব্যাক', ['id' => $batch->id]).($batch->rollback_reason ? ': '.$batch->rollback_reason : '');
            match ($batch->type) {
                'farmers' => $this->undoFarmers($batch),
                'lands' => Land::withTrashed()->where('import_batch_id', $batch->id)->get()->each->forceDelete(),
                'savings_opening', 'share_opening' => $this->undoOpenings($batch, $reason),
                'loan_opening' => $this->undoLoans($batch, $reason),
                'legacy_irrigation' => $this->undoInvoices($batch, $reason),
                'payments' => $this->undoPayments($batch, $reason),
            };
            $batch->update(['status' => 'rolled_back', 'rolled_back_at' => now(), 'rolled_back_by' => auth()->id()]);
            AuditLogger::log('import', 'rollback', $batch, null, ['type' => $batch->type, 'rows' => $batch->imported_rows, 'reason' => $batch->rollback_reason]);
        });
    }

    /** Rejected or sent back: the batch stays as it is. */
    public function keep(ImportBatch $batch): void
    {
        ImportBatch::whereKey($batch->id)->where('status', 'rollback_pending')->update(['status' => 'completed']);
    }

    // ------------------------------------------------------------ blockers

    private function farmerBlockers(ImportBatch $batch): array
    {
        $farmers = Farmer::withTrashed()->where('import_batch_id', $batch->id)->get(['id', 'farmer_code', 'name_bn']);
        $ids = $farmers->pluck('id');
        $memberIds = Member::whereIn('farmer_id', $ids)->pluck('id', 'farmer_id');
        $used = [];
        foreach (self::FARMER_REFS as $col => $tables) {
            foreach ($tables as $t) {
                foreach (DB::table($t)->whereIn($col, $ids)->distinct()->pluck($col) as $id) {
                    $used[$id][] = $t;
                }
            }
        }
        foreach (self::MEMBER_REFS as $t) {
            foreach (DB::table($t)->whereIn('member_id', $memberIds->values())->distinct()->pluck('member_id') as $mid) {
                $used[$memberIds->search($mid)][] = $t;
            }
        }
        $withTxns = DB::table('member_accounts')->whereIn('member_id', $memberIds->values())
            ->whereExists(fn ($q) => $q->from('member_transactions')->whereColumn('member_transactions.member_account_id', 'member_accounts.id'))
            ->distinct()->pluck('member_id');
        foreach ($withTxns as $mid) {
            $used[$memberIds->search($mid)][] = 'member_accounts';
        }
        $byId = $farmers->keyBy('id');

        return collect($used)->map(fn ($tables, $id) => __(':code :name — :where-এ ব্যবহৃত', [
            'code' => $byId[$id]->farmer_code ?? '', 'name' => $byId[$id]->name_bn ?? '',
            'where' => collect($tables)->unique()->map(fn ($t) => __(self::TABLE_LABELS[$t] ?? $t))->implode(', '),
        ]))->values()->all();
    }

    private const TABLE_LABELS = [
        'land_owners' => 'জমির মালিকানা', 'land_cultivations' => 'চাষাবাদ', 'invoices' => 'সেচ ইনভয়েস', 'receipts' => 'রশিদ',
        'membership_applications' => 'সদস্যপদের আবেদন', 'combined_payments' => 'সমন্বিত রশিদ', 'public_payment_requests' => 'অনলাইন পেমেন্ট',
        'farmers' => 'কৃষক একত্রীকরণ', 'member_accounts' => 'সঞ্চয়/শেয়ার হিসাব', 'loans' => 'ঋণ', 'loan_guarantors' => 'ঋণের জামিনদার',
        'voter_list_items' => 'ভোটার তালিকা', 'distribution_items' => 'মুনাফা/লভ্যাংশ বণ্টন',
    ];

    private function landBlockers(ImportBatch $batch): array
    {
        return Invoice::with('land:id,land_code')->whereIn('land_id', Land::withTrashed()->where('import_batch_id', $batch->id)->select('id'))
            ->get(['id', 'invoice_no', 'land_id'])
            ->map(fn ($i) => __('জমি :land — ইনভয়েস :no তৈরি হয়েছে', ['land' => $i->land?->land_code, 'no' => $i->invoice_no]))->all();
    }

    private function openingBlockers(ImportBatch $batch): array
    {
        $out = [];
        foreach (MemberTransaction::with('account:id,account_no,balance')->where('import_batch_id', $batch->id)->where('status', '!=', 'cancelled')->get() as $txn) {
            $later = MemberTransaction::where('member_account_id', $txn->member_account_id)->where('id', '>', $txn->id)
                ->where('status', '!=', 'cancelled')->count();
            if ($later) {
                $out[] = __('হিসাব :no — পরে :n টি লেনদেন হয়েছে', ['no' => $txn->account?->account_no, 'n' => $later]);
            } elseif ($txn->status !== 'posted') {
                $out[] = __('লেনদেন :no — বাতিলের অনুরোধ চলমান', ['no' => $txn->txn_no]);
            } elseif ((float) $txn->account?->balance < (float) $txn->amount) {
                $out[] = __('হিসাব :no — জের প্রারম্ভিক জেরের চেয়ে কম', ['no' => $txn->account?->account_no]);
            }
        }

        return $out;
    }

    private function loanBlockers(ImportBatch $batch): array
    {
        return Loan::where('import_batch_id', $batch->id)->where('status', '!=', 'cancelled')
            ->withCount(['payments' => fn ($q) => $q->where('status', '!=', 'cancelled')])->get()
            ->filter(fn ($l) => $l->payments_count > 0)
            ->map(fn ($l) => __('ঋণ :no — পরে :n টি কিস্তি আদায় হয়েছে', ['no' => $l->loan_no, 'n' => $l->payments_count]))->values()->all();
    }

    private function invoiceBlockers(ImportBatch $batch): array
    {
        $invoices = Invoice::where('import_batch_id', $batch->id)->where('status', '!=', 'cancelled')->pluck('invoice_no', 'id');

        return ReceiptItem::with('receipt:id,receipt_no')->where('payable_type', (new Invoice)->getMorphClass())
            ->whereIn('payable_id', $invoices->keys())->whereHas('receipt', fn ($q) => $q->where('status', '!=', 'cancelled'))->get()
            ->map(fn ($i) => __('ইনভয়েস :no — রশিদ :r দিয়ে আদায় হয়েছে', ['no' => $invoices[$i->payable_id], 'r' => $i->receipt?->receipt_no]))->all();
    }

    private function paymentBlockers(ImportBatch $batch): array
    {
        $out = [];
        foreach (Receipt::where('import_batch_id', $batch->id)->where('status', '!=', 'cancelled')->get() as $r) {
            if ($r->status !== 'active') {
                $out[] = __('রশিদ :no — বাতিলের অনুরোধ চলমান', ['no' => $r->receipt_no]);
            }
            try {
                CombinedPaymentService::guardPart($r);
            } catch (ValidationException) {
                $out[] = __('রশিদ :no — সমন্বিত রশিদের অংশ', ['no' => $r->receipt_no]);
            }
        }

        return $out;
    }

    // ---------------------------------------------------------------- undo

    private function undoFarmers(ImportBatch $batch): void
    {
        $ids = Farmer::withTrashed()->where('import_batch_id', $batch->id)->pluck('id');
        // the accounts opened with the membership are empty (the blocker check made sure of it)
        MemberAccount::whereIn('member_id', Member::whereIn('farmer_id', $ids)->select('id'))->get()->each->delete();
        Member::whereIn('farmer_id', $ids)->get()->each->delete(); // nominees + status history cascade
        Farmer::withTrashed()->whereIn('id', $ids)->get()->each->forceDelete();
    }

    private function undoOpenings(ImportBatch $batch, string $reason): void
    {
        foreach (MemberTransaction::where('import_batch_id', $batch->id)->where('status', 'posted')->orderByDesc('id')->get() as $txn) {
            $txn->update(['cancel_reason' => $reason]);
            $this->funds->cancel($txn);
        }
    }

    private function undoLoans(ImportBatch $batch, string $reason): void
    {
        foreach (Loan::with('journal')->where('import_batch_id', $batch->id)->where('status', '!=', 'cancelled')->get() as $loan) {
            if ($loan->journal && $loan->journal->status === 'posted') {
                $this->ledger->reverse($loan->journal, $reason);
            }
            $loan->schedule()->delete();
            $loan->update(['status' => 'cancelled', 'closed_on' => null, 'remarks' => mb_substr(trim($loan->remarks.' | '.$reason, ' |'), 0, 500)]);
        }
    }

    private function undoInvoices(ImportBatch $batch, string $reason): void
    {
        foreach (Invoice::with('journal')->where('import_batch_id', $batch->id)->where('status', '!=', 'cancelled')->get() as $invoice) {
            if ($invoice->journal && $invoice->journal->status === 'posted') {
                $this->ledger->reverse($invoice->journal, $reason);
            }
            $invoice->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancelled_by' => auth()->id(), 'cancel_reason' => mb_substr($reason, 0, 500)]);
        }
    }

    private function undoPayments(ImportBatch $batch, string $reason): void
    {
        foreach (Receipt::where('import_batch_id', $batch->id)->where('status', 'active')->orderByDesc('id')->get() as $receipt) {
            $receipt->update(['cancel_reason' => mb_substr($reason, 0, 300)]);
            $this->receipts->cancel($receipt);
        }
    }
}
