<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DistributionRun;
use App\Models\Member;
use App\Models\MemberAccount;
use App\Services\MemberFundService;
use App\Support\CsvExport;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Profit on savings (savings.*) and dividend on share capital (share.*). */
class DistributionController extends Controller
{
    private const PERM = ['profit' => 'savings', 'dividend' => 'share'];

    public function __construct(private MemberFundService $funds) {}

    public function index(Request $request): JsonResponse
    {
        $kinds = array_keys(array_filter(self::PERM, fn ($m) => $request->user()->can($m.'.view')));
        abort_unless($kinds, 403, __('অনুমতি নেই'));
        $q = DistributionRun::whereIn('kind', $kinds)->when($request->query('kind'), fn ($q, $k) => $q->where('kind', $k))
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))->withCount('items')
            ->with('creator:id,name_bn,name_en')->orderByDesc('date')->orderByDesc('id');

        return response()->json($q->paginate($this->perPage($request))->toArray()
            + ['kinds' => Tr::map(DistributionRun::KINDS), 'statuses' => Tr::map(DistributionRun::STATUSES)]);
    }

    public function show(Request $request, DistributionRun $run)
    {
        $this->allow($request, $run->kind, 'view');
        $run->load(['items.member:id,farmer_id,member_no', 'items.member.farmer:id,farmer_code,name_bn,name_en,father_name',
            'items.transaction:id,txn_no', 'journal:id,voucher_no,status', 'creator:id,name_bn,name_en']);
        if ($request->query('export') === 'csv') {
            return CsvExport::download($run->run_no.'.csv', [__('সদস্য নং'), __('নাম'), __('পিতার নাম'), __('ভিত্তি'), __('টাকা'), __('লেনদেন নং')],
                $run->items->map(fn ($i) => [$i->member?->member_no, $i->member?->farmer?->name_bn, $i->member?->farmer?->father_name, $i->basis, $i->amount, $i->transaction?->txn_no]));
        }

        return response()->json($run->toArray() + ['kinds' => Tr::map(DistributionRun::KINDS), 'statuses' => Tr::map(DistributionRun::STATUSES)]);
    }

    /**
     * profit: every savings account with its balance, for typing amounts.
     * dividend: the pro-rata split of `pool_amount` on share balances as of `basis_date`.
     */
    public function preview(Request $request, string $kind): JsonResponse
    {
        $this->allow($request, $kind, 'edit');
        if ($kind === 'profit') {
            $rows = MemberAccount::where('kind', 'savings')->where('status', 'active')
                ->with(['member:id,farmer_id,member_no,status', 'member.farmer:id,farmer_code,name_bn,name_en,father_name'])->orderBy('account_no')->get()
                ->map(fn (MemberAccount $a) => ['member_id' => $a->member_id, 'member_no' => $a->member?->member_no, 'member_status' => $a->member?->status,
                    'farmer' => $a->member?->farmer, 'account_no' => $a->account_no, 'basis' => (float) $a->balance, 'amount' => 0]);

            return response()->json(['rows' => $rows, 'total_basis' => round($rows->sum('basis'), 2)]);
        }
        $data = $request->validate(['basis_date' => ['required', 'date'], 'pool_amount' => ['required', 'numeric', 'min:0.01', 'max:9999999999999']]);

        return response()->json($this->dividendRows($data['basis_date'], (float) $data['pool_amount']));
    }

    public function store(Request $request, string $kind): JsonResponse
    {
        $this->allow($request, $kind, 'edit');
        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'date' => ['required', 'date', 'before_or_equal:today'],
            'remarks' => ['nullable', 'string', 'max:500'],
            'basis_date' => [$kind === 'dividend' ? 'required' : 'nullable', 'date'],
            'pool_amount' => [$kind === 'dividend' ? 'required' : 'nullable', 'numeric', 'min:0.01', 'max:9999999999999'],
            'items' => [$kind === 'profit' ? 'required' : 'nullable', 'array', 'max:20000'],
            'items.*.member_id' => ['required', 'integer', Rule::exists('members', 'id')],
            'items.*.amount' => ['required', 'numeric', 'min:0', 'max:9999999999999'],
        ]);
        if ($kind === 'profit') {
            $balances = MemberAccount::where('kind', 'savings')->pluck('balance', 'member_id');
            $items = array_map(fn ($i) => ['member_id' => (int) $i['member_id'], 'basis' => (float) ($balances[$i['member_id']] ?? 0), 'amount' => (float) $i['amount']], $data['items']);
        } else {
            // Recomputed here — the client's preview is never trusted for money.
            $items = $this->funds->dividendShares($data['basis_date'], (float) $data['pool_amount']);
        }
        $run = $this->funds->createRun($kind, $data, $items);

        return response()->json(['id' => $run->id, 'run_no' => $run->run_no, 'status' => $run->status,
            'message' => $run->status === 'posted' ? __('বণ্টন সম্পন্ন হয়েছে।') : __('অনুমোদনের জন্য পাঠানো হয়েছে।')], 201);
    }

    private function dividendRows(string $basisDate, float $pool): array
    {
        $shares = $this->funds->dividendShares($basisDate, $pool);
        $members = Member::with('farmer:id,farmer_code,name_bn,name_en,father_name')->whereIn('id', array_column($shares, 'member_id'))->get()->keyBy('id');
        $rows = array_map(fn ($s) => $s + ['member_no' => $members[$s['member_id']]->member_no ?? null, 'member_status' => $members[$s['member_id']]->status ?? null,
            'farmer' => $members[$s['member_id']]->farmer ?? null], $shares);

        return ['rows' => $rows, 'total_basis' => round(array_sum(array_column($shares, 'basis')), 2), 'total' => round(array_sum(array_column($shares, 'amount')), 2)];
    }

    private function allow(Request $request, string $kind, string $ability): void
    {
        abort_unless(isset(self::PERM[$kind]) && $request->user()->can(self::PERM[$kind].'.'.$ability), 403, __('অনুমতি নেই'));
    }
}
