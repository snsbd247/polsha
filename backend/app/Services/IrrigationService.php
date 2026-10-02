<?php

namespace App\Services;

use App\Models\Account;
use App\Models\ApprovalRequest;
use App\Models\Invoice;
use App\Models\InvoiceBatch;
use App\Models\IrrigationRate;
use App\Models\IrrigationType;
use App\Models\Land;
use App\Models\Season;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Seasons, approved per-শতক rates and irrigation invoices. Every invoice is
 * booked the moment it is raised (Dr irrigation receivable / Cr irrigation
 * income) and is always billed to whoever cultivates the land.
 */
class IrrigationService
{
    /** Why a land can't be billed — shown in the bulk preview. */
    public const SKIP_REASONS = [
        'land_status' => 'জমি চাষাধীন নয়',
        'no_cultivator' => 'চাষি নির্ধারিত নেই',
        'no_irrigation_type' => 'সেচের ধরন নেই',
        'no_rate' => 'অনুমোদিত রেট নেই',
        'already_invoiced' => 'এই মৌসুমে ইনভয়েস হয়ে গেছে',
        'zero_amount' => 'টাকার পরিমাণ শূন্য',
    ];

    public function __construct(private LedgerService $ledger, private ApprovalService $approvals) {}

    /** Approved rate in force on a date: exact land type beats the "all land types" row, later start date wins. */
    public function rateFor(int $seasonId, ?int $landTypeId, int $irrigationTypeId, string $date): ?IrrigationRate
    {
        return IrrigationRate::where('season_id', $seasonId)->where('irrigation_type_id', $irrigationTypeId)
            ->where('status', 'approved')->whereDate('effective_from', '<=', $date)
            ->where(fn ($q) => $q->whereNull('land_type_id')->when($landTypeId, fn ($w) => $w->orWhere('land_type_id', $landTypeId)))
            ->orderByRaw('land_type_id IS NULL')->orderByDesc('effective_from')->orderByDesc('id')
            ->first();
    }

    /** A rate change is a new row, live only after approval. */
    public function proposeRate(array $data): IrrigationRate
    {
        $season = Season::findOrFail($data['season_id']);
        $this->guardSeasonOpen($season);
        $exists = IrrigationRate::where('season_id', $season->id)->where('irrigation_type_id', $data['irrigation_type_id'])
            ->where('land_type_id', $data['land_type_id'] ?? null)->where('status', 'pending')->exists();
        if ($exists) {
            throw ValidationException::withMessages(['rate' => __('এই রেটের একটি পরিবর্তন আগেই অনুমোদনের অপেক্ষায় আছে।')]);
        }

        return DB::transaction(function () use ($data, $season) {
            $rate = IrrigationRate::create($data + ['status' => 'pending', 'created_by' => auth()->id()]);
            $rate->load('irrigationType', 'landType');
            $current = $this->rateFor($season->id, $rate->land_type_id, $rate->irrigation_type_id, $rate->effective_from->toDateString());
            $landType = $rate->landType ? $rate->landType->name_bn : 'সব ধরনের জমি';

            $request = $this->approvals->submit(
                'irrigation.rate',
                __('সেচের রেট: :season — :type', ['season' => $season->name_bn, 'type' => $rate->irrigationType->name_bn]),
                $rate,
                [
                    'মৌসুম' => $season->name_bn,
                    'সেচের ধরন' => $rate->irrigationType->name_bn,
                    'জমির ধরন' => $landType,
                    'নতুন রেট (প্রতি শতক)' => (float) $rate->rate,
                    'কার্যকর তারিখ' => $rate->effective_from->format('d/m/Y'),
                    'কারণ' => $rate->reason,
                ],
                $current ? ['রেট (প্রতি শতক)' => (float) $current->rate, 'কার্যকর তারিখ' => $current->effective_from->format('d/m/Y')] : null,
            );
            $rate->update(['approval_request_id' => $request->id]);

            return $rate->fresh();
        });
    }

    /**
     * The rates a season would take over from another: the latest approved
     * rate of each source × land type there, beside what the target season
     * already has (those are not copied again).
     *
     * @return list<array{irrigation_type_id:int, land_type_id:?int, irrigation_type:string, land_type:?string, rate:float, exists:bool}>
     */
    public function copyPreview(Season $from, Season $to): array
    {
        $taken = IrrigationRate::where('season_id', $to->id)->whereIn('status', ['approved', 'pending'])
            ->get(['irrigation_type_id', 'land_type_id'])->map(fn ($r) => $r->irrigation_type_id.'-'.($r->land_type_id ?? 0))->flip();

        return IrrigationRate::with(['irrigationType:id,name_bn', 'landType:id,name_bn'])->where('season_id', $from->id)->where('status', 'approved')
            ->orderByDesc('effective_from')->orderByDesc('id')->get()
            ->unique(fn ($r) => $r->irrigation_type_id.'-'.($r->land_type_id ?? 0))
            ->map(fn (IrrigationRate $r) => [
                'irrigation_type_id' => $r->irrigation_type_id, 'land_type_id' => $r->land_type_id,
                'irrigation_type' => $r->irrigationType?->name_bn, 'land_type' => $r->landType?->name_bn, 'rate' => (float) $r->rate,
                'exists' => isset($taken[$r->irrigation_type_id.'-'.($r->land_type_id ?? 0)]),
            ])->sortBy(['irrigation_type', 'land_type'])->values()->all();
    }

    /**
     * Copy another season's rates (with any changes) into a season. All of
     * them go for approval together in one request, and go live together.
     *
     * @param  array<int, array{irrigation_type_id:int, land_type_id:?int, rate:float}>  $rows
     * @return list<IrrigationRate>
     */
    public function copyRates(Season $from, Season $to, array $rows, string $effectiveFrom): array
    {
        $this->guardSeasonOpen($to);
        $allowed = collect($this->copyPreview($from, $to))->reject(fn ($r) => $r['exists'])->keyBy(fn ($r) => $r['irrigation_type_id'].'-'.($r['land_type_id'] ?? 0));
        $rows = collect($rows)->filter(fn ($r) => $allowed->has($r['irrigation_type_id'].'-'.($r['land_type_id'] ?? 0)) && (float) $r['rate'] > 0)->values();
        if ($rows->isEmpty()) {
            throw ValidationException::withMessages(['rows' => __('কপি করার মতো কোনো রেট নেই — এই মৌসুমে সব রেট আগে থেকেই আছে বা অনুমোদনের অপেক্ষায়।')]);
        }

        return DB::transaction(function () use ($from, $to, $rows, $effectiveFrom) {
            $rates = $rows->map(fn ($r) => IrrigationRate::create([
                'season_id' => $to->id, 'irrigation_type_id' => $r['irrigation_type_id'], 'land_type_id' => $r['land_type_id'] ?? null,
                'rate' => round((float) $r['rate'], 2), 'effective_from' => $effectiveFrom, 'status' => 'pending', 'created_by' => auth()->id(),
                'reason' => __(':season থেকে কপি', ['season' => $from->name_bn]),
            ])->load('irrigationType:id,name_bn', 'landType:id,name_bn'));
            $payload = ['মৌসুম' => $to->name_bn, 'কপি করা হয়েছে' => $from->name_bn, 'কার্যকর তারিখ' => date('d/m/Y', strtotime($effectiveFrom))];
            foreach ($rates as $r) {
                $payload[$r->irrigationType->name_bn.' — '.($r->landType?->name_bn ?? 'সব ধরনের জমি').' (প্রতি শতক)'] = (float) $r->rate;
            }
            // one request for all; without an approval rule the handler has already put them live
            $request = $this->approvals->submit('irrigation.rate_batch', __('সেচের রেট (:n টি): :season', ['n' => $rates->count(), 'season' => $to->name_bn]), $to, $payload);
            IrrigationRate::whereIn('id', $rates->pluck('id'))->where('status', 'pending')->update(['approval_request_id' => $request->id]);

            return IrrigationRate::whereIn('id', $rates->pluck('id'))->get()->all();
        });
    }

    /**
     * What a land would be billed for a season — or why it can't be.
     *
     * @return array{ok:bool, reason:?string, land_id:int, farmer_id:?int, cultivation_type:?string, area_decimal:float, rate:?float, rate_id:?int, amount:float, irrigation_type_id:?int, snapshot:array}
     */
    public function candidate(Land $land, Season $season, string $date, ?int $irrigationTypeId = null, ?float $area = null, bool $skipDuplicateCheck = false): array
    {
        $land->loadMissing(['mouza:id,name_bn,name_en,jl_no', 'landType:id,name_bn', 'irrigationType:id,name_bn',
            'owners.farmer:id,farmer_code,name_bn,name_en,father_name', 'cultivation.farmer:id,farmer_code,name_bn,name_en,father_name,mobile']);
        $typeId = $irrigationTypeId ?: $land->irrigation_type_id;
        $area = round($area ?? (float) $land->area_decimal, 4);
        $cult = $land->cultivation;
        $rate = $typeId ? $this->rateFor($season->id, $land->land_type_id, $typeId, $date) : null;
        $amount = $rate ? round($area * (float) $rate->rate, 2) : 0.0;

        $reason = match (true) {
            $land->status !== 'cultivated' => 'land_status',
            ! $cult => 'no_cultivator',
            ! $typeId => 'no_irrigation_type',
            ! $rate => 'no_rate',
            ! $skipDuplicateCheck && $this->hasInvoice($land->id, $season->id) => 'already_invoiced',
            $amount <= 0 => 'zero_amount',
            default => null,
        };

        $irrigationType = $typeId ? ($typeId === $land->irrigation_type_id ? $land->irrigationType : IrrigationType::find($typeId)) : null;

        return [
            'ok' => $reason === null,
            'reason' => $reason,
            'land_id' => $land->id,
            'farmer_id' => $cult?->farmer_id,
            'cultivation_type' => $cult?->type,
            'land_type_id' => $land->land_type_id,
            'irrigation_type_id' => $typeId,
            'area_decimal' => $area,
            'rate' => $rate ? (float) $rate->rate : null,
            'rate_id' => $rate?->id,
            'amount' => $amount,
            'snapshot' => [
                'season' => $season->name_bn,
                'crop' => $season->crop,
                'land_code' => $land->land_code,
                'mouza' => $land->mouza?->name_bn,
                'mouza_en' => $land->mouza?->name_en,
                'jl_no' => $land->mouza?->jl_no,
                'survey' => $land->survey,
                'khatian_no' => $land->khatian_no,
                'dag_no' => $land->dag_no,
                'land_area' => (float) $land->area_decimal,
                'land_type' => $land->landType?->name_bn,
                'irrigation_type' => $irrigationType?->name_bn,
                'cultivator' => $cult ? [
                    'id' => $cult->farmer_id, 'farmer_code' => $cult->farmer?->farmer_code, 'name_bn' => $cult->farmer?->name_bn,
                    'name_en' => $cult->farmer?->name_en, 'father_name' => $cult->farmer?->father_name, 'mobile' => $cult->farmer?->mobile,
                ] : null,
                'owners' => $land->owners->map(fn ($o) => [
                    'id' => $o->farmer_id, 'farmer_code' => $o->farmer?->farmer_code, 'name_bn' => $o->farmer?->name_bn,
                    'name_en' => $o->farmer?->name_en, 'father_name' => $o->farmer?->father_name, 'share_percent' => (float) $o->share_percent,
                ])->values()->all(),
            ],
        ];
    }

    public function createInvoice(Land $land, Season $season, array $opts): Invoice
    {
        $this->guardSeasonOpen($season);
        $date = $opts['invoice_date'];

        return DB::transaction(function () use ($land, $season, $opts, $date) {
            // Serialise per land so two clerks can't bill the same land twice.
            Land::whereKey($land->id)->lockForUpdate()->first();
            $c = $this->candidate($land, $season, $date, $opts['irrigation_type_id'] ?? null, $opts['area_decimal'] ?? null);
            if (! $c['ok']) {
                throw ValidationException::withMessages(['land_id' => __(self::SKIP_REASONS[$c['reason']])]);
            }

            return $this->book($c, $season, $opts + ['due_date' => $season->due_date?->toDateString()]);
        });
    }

    /** @return array{lines: Collection, summary: array} */
    /** @param array{irrigation_type_id?: ?int, land_ids?: ?array} $only narrows the run to one irrigation source and/or chosen plots */
    public function preview(Season $season, ?int $mouzaId, string $date, array $only = []): array
    {
        $lands = Land::query()->when($mouzaId, fn ($q) => $q->where('mouza_id', $mouzaId))
            ->when($only['irrigation_type_id'] ?? null, fn ($q, $v) => $q->where('irrigation_type_id', $v))
            ->when($only['land_ids'] ?? null, fn ($q, $v) => $q->whereIn('id', $v))
            ->with(['mouza:id,name_bn,name_en,jl_no', 'landType:id,name_bn', 'irrigationType:id,name_bn',
                'owners.farmer:id,farmer_code,name_bn,name_en,father_name', 'cultivation.farmer:id,farmer_code,name_bn,name_en,father_name,mobile'])
            ->orderBy('mouza_id')->orderBy('land_code')->get();
        $invoiced = Invoice::where('season_id', $season->id)->where('status', '!=', 'cancelled')->pluck('land_id')->flip();
        $lines = $lands->map(function (Land $l) use ($season, $date, $invoiced) {
            $c = $this->candidate($l, $season, $date, null, null, true);
            if ($c['ok'] && isset($invoiced[$l->id])) {
                $c['ok'] = false;
                $c['reason'] = 'already_invoiced';
            }

            return $c;
        });

        $ok = $lines->where('ok', true);
        $byType = $ok->groupBy('cultivation_type')->map(fn ($g) => ['count' => $g->count(), 'area' => round($g->sum('area_decimal'), 4), 'amount' => round($g->sum('amount'), 2)]);

        return [
            'lines' => $lines,
            'summary' => [
                'lands' => $lines->count(),
                'invoices' => $ok->count(),
                'farmers' => $ok->pluck('farmer_id')->unique()->count(),
                'area' => round($ok->sum('area_decimal'), 4),
                'amount' => round($ok->sum('amount'), 2),
                'by_cultivation' => $byType,
                'skipped' => $lines->where('ok', false)->countBy('reason'),
            ],
        ];
    }

    public function bulk(Season $season, ?int $mouzaId, string $date, array $only = []): InvoiceBatch
    {
        $this->guardSeasonOpen($season);

        return DB::transaction(function () use ($season, $mouzaId, $date, $only) {
            // One bulk run per season at a time; the season row is the lock.
            Season::whereKey($season->id)->lockForUpdate()->first();
            $preview = $this->preview($season, $mouzaId, $date, $only);
            $ok = $preview['lines']->where('ok', true);
            if ($ok->isEmpty()) {
                throw ValidationException::withMessages(['season_id' => __('ইনভয়েস তৈরির মতো কোনো জমি পাওয়া যায়নি।')]);
            }
            $batch = InvoiceBatch::create([
                'season_id' => $season->id, 'mouza_id' => $mouzaId, 'invoice_date' => $date,
                'skipped_count' => $preview['lines']->count() - $ok->count(), 'created_by' => auth()->id(),
            ]);
            foreach ($ok as $c) {
                $this->book($c, $season, ['invoice_date' => $date, 'due_date' => $season->due_date?->toDateString(), 'batch_id' => $batch->id]);
            }
            $batch->update(['invoice_count' => $ok->count(), 'total_amount' => round($ok->sum('amount'), 2)]);

            return $batch;
        });
    }

    public function requestCancel(Invoice $invoice, string $reason): ApprovalRequest
    {
        if ($invoice->status === 'cancelled') {
            throw ValidationException::withMessages(['invoice' => __('ইনভয়েসটি আগেই বাতিল হয়েছে।')]);
        }
        if ((float) $invoice->paid_amount > 0) {
            throw ValidationException::withMessages(['invoice' => __('আদায় হওয়া ইনভয়েস বাতিল করা যাবে না; আগে রশিদ বাতিল করুন।')]);
        }
        if ($this->pendingApproval('irrigation.invoice_cancel', $invoice)) {
            throw ValidationException::withMessages(['invoice' => __('এই ইনভয়েস বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় আছে।')]);
        }

        return $this->approvals->submit(
            'irrigation.invoice_cancel',
            __('ইনভয়েস বাতিল: :no', ['no' => $invoice->invoice_no]),
            $invoice,
            ['ইনভয়েস' => $invoice->invoice_no, 'চাষি' => $invoice->snapshot['cultivator']['name_bn'] ?? '', 'পরিমাণ' => (float) $invoice->amount, 'কারণ' => $reason],
            null,
            (float) $invoice->amount,
        );
    }

    /** Approval handler: reverse the invoice voucher and void the bill. */
    public function cancel(Invoice $invoice, ?string $reason): void
    {
        DB::transaction(function () use ($invoice, $reason) {
            $invoice = Invoice::whereKey($invoice->id)->lockForUpdate()->firstOrFail();
            if ($invoice->status === 'cancelled') {
                return;
            }
            if ((float) $invoice->paid_amount > 0) {
                throw ValidationException::withMessages(['invoice' => __('আদায় হওয়া ইনভয়েস বাতিল করা যাবে না; আগে রশিদ বাতিল করুন।')]);
            }
            if ($invoice->journal && $invoice->journal->status === 'posted') {
                $this->ledger->reverse($invoice->journal, __('ইনভয়েস বাতিল'));
            }
            $invoice->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancelled_by' => auth()->id(), 'cancel_reason' => $reason]);
        });
    }

    public function pendingApproval(string $actionKey, $model): bool
    {
        return ApprovalRequest::where('action_key', $actionKey)->where('status', ApprovalRequest::PENDING)
            ->where('approvable_type', $model::class)->where('approvable_id', $model->id)->exists();
    }

    private function book(array $c, Season $season, array $opts): Invoice
    {
        // extra charge lines and a discount only come from the single-invoice form
        $charges = collect($opts['charges'] ?? [])->map(fn ($l) => [
            'description' => trim((string) $l['description']), 'qty' => (float) $l['qty'], 'rate' => (float) $l['rate'],
            'amount' => round((float) $l['qty'] * (float) $l['rate'], 2),
        ])->filter(fn ($l) => $l['amount'] > 0)->values()->all();
        $discount = round((float) ($opts['discount'] ?? 0), 2);
        $total = round($c['amount'] + collect($charges)->sum('amount') - $discount, 2);
        if ($total <= 0) {
            throw ValidationException::withMessages(['discount' => __('ছাড় বিলের চেয়ে বেশি হতে পারে না।')]);
        }
        $c['amount'] = $total;

        $invoice = Invoice::create([
            'invoice_no' => SequenceService::next('irrigation_invoice'),
            'season_id' => $season->id,
            'land_id' => $c['land_id'],
            'farmer_id' => $c['farmer_id'],
            'cultivation_type' => $c['cultivation_type'],
            'land_type_id' => $c['land_type_id'],
            'irrigation_type_id' => $c['irrigation_type_id'],
            'rate_id' => $c['rate_id'],
            'invoice_date' => $opts['invoice_date'],
            'due_date' => $opts['due_date'] ?? null,
            'area_decimal' => $c['area_decimal'],
            'rate' => $c['rate'],
            'charges' => $charges ?: null,
            'discount' => $discount,
            'amount' => $c['amount'],
            'paid_amount' => 0,
            'status' => 'unpaid',
            'snapshot' => $c['snapshot'],
            'remarks' => $opts['remarks'] ?? null,
            'batch_id' => $opts['batch_id'] ?? null,
            'created_by' => auth()->id(),
        ]);

        $journal = $this->ledger->postNow('journal', $opts['invoice_date'],
            __('সেচ ইনভয়েস :no — :name, দাগ :dag', ['no' => $invoice->invoice_no, 'name' => $c['snapshot']['cultivator']['name_bn'] ?? '', 'dag' => $c['snapshot']['dag_no']]),
            [
                ['account_id' => Account::byKey('irrigation_receivable')->id, 'debit' => $c['amount']],
                ['account_id' => Account::byKey('irrigation_income')->id, 'credit' => $c['amount']],
            ], 'irrigation', $invoice);
        $invoice->update(['journal_id' => $journal->id]);

        return $invoice;
    }

    private function hasInvoice(int $landId, int $seasonId): bool
    {
        return Invoice::where('land_id', $landId)->where('season_id', $seasonId)->where('status', '!=', 'cancelled')->exists();
    }

    private function guardSeasonOpen(Season $season): void
    {
        if ($season->status === 'closed') {
            throw ValidationException::withMessages(['season_id' => __('মৌসুমটি বন্ধ করা হয়েছে।')]);
        }
    }
}
