<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Asset;
use App\Models\CombinedPayment;
use App\Models\Farmer;
use App\Models\Land;
use App\Models\Member;
use App\Models\QrScan;
use App\Models\Receipt;
use App\Support\Bn;
use App\Support\Tr;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * QR labels carry "{origin}/q/{type}/{code}". Opening one (camera, typed
 * code or a plain link) lands here: the code is looked up, every scan is
 * logged, and the app is told which screen to open.
 */
class QrController extends Controller
{
    public function resolve(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(array_keys(QrScan::TYPES))],
            'code' => ['required', 'string', 'max:100'],
            'source' => ['nullable', Rule::in(['camera', 'manual', 'link'])],
        ]);
        $code = trim(Bn::toEnDigits($data['code']));
        [$entity, $label, $path, $permission] = $this->lookup($data['type'], $code);

        QrScan::create([
            'user_id' => $request->user()->id, 'entity_type' => $data['type'], 'entity_id' => $entity?->getKey(),
            'code' => mb_substr($code, 0, 100), 'label' => $label ? mb_substr($label, 0, 200) : null, 'found' => $entity !== null,
            'source' => $data['source'] ?? 'link', 'ip' => $request->ip(), 'user_agent' => mb_substr((string) $request->userAgent(), 0, 255),
        ]);
        abort_unless($entity, 404, __('এই কোডের কোনো তথ্য পাওয়া যায়নি।'));

        return response()->json([
            'type' => $data['type'], 'id' => $entity->getKey(), 'label' => $label, 'path' => $path,
            'allowed' => $permission === null || $request->user()->can($permission),
        ]);
    }

    /** Own scans; with audit.view, everyone's. */
    public function history(Request $request): JsonResponse
    {
        $q = QrScan::with('user:id,name_bn,name_en,username');
        if (! $request->user()->can('audit.view') || ! $request->boolean('all')) {
            $q->where('user_id', $request->user()->id);
        }
        foreach (['entity_type', 'source'] as $f) {
            if ($request->filled($f)) {
                $q->where($f, $request->query($f));
            }
        }
        if ($request->filled('found')) {
            $q->where('found', $request->boolean('found'));
        }
        if ($request->filled('from')) {
            $q->whereDate('created_at', '>=', $request->query('from'));
        }
        if ($request->filled('to')) {
            $q->whereDate('created_at', '<=', $request->query('to'));
        }
        if ($search = trim((string) $request->query('search'))) {
            $en = Bn::toEnDigits($search);
            $q->where(fn ($w) => $w->where('code', 'like', "%$en%")->orWhere('label', 'like', "%$search%"));
        }

        // card figures over the same scope (mine, or everyone's) before the filters narrow the list
        $scope = QrScan::query()->when(! $request->user()->can('audit.view') || ! $request->boolean('all'), fn ($w) => $w->where('user_id', $request->user()->id));
        $counts = ['total' => (clone $scope)->count(), 'found' => (clone $scope)->where('found', true)->count(),
            'missing' => (clone $scope)->where('found', false)->count(), 'today' => (clone $scope)->where('created_at', '>=', now()->startOfDay())->count()];

        return response()->json($q->orderByDesc('id')->paginate($this->perPage($request))->toArray()
            + ['types' => Tr::map(QrScan::TYPES), 'can_all' => $request->user()->can('audit.view'), 'counts' => $counts]);
    }

    /** @return array{0: ?Model, 1: ?string, 2: ?string, 3: ?string} */
    private function lookup(string $type, string $code): array
    {
        switch ($type) {
            case 'farmer':
                $f = Farmer::where('farmer_code', $code)->first();

                return [$f, $f ? "$f->name_bn ($f->farmer_code)" : null, $f ? "/farmers/$f->id" : null, 'farmer.view'];
            case 'member':
                $m = ctype_digit($code) ? Member::with('farmer:id,name_bn,farmer_code')->where('member_no', (int) $code)->first() : null;

                return [$m, $m ? __('সদস্য নং :no', ['no' => $m->member_no]).' — '.$m->farmer?->name_bn : null, $m ? '/farmers/'.$m->farmer_id : null, 'farmer.view'];
            case 'land':
                $l = Land::with('mouza:id,name_bn')->where('land_code', $code)->first();

                return [$l, $l ? "$l->land_code — ".$l->mouza?->name_bn.' / '.__('দাগ').' '.$l->dag_no : null, $l ? "/lands/$l->id" : null, 'land.view'];
            case 'asset':
                $a = Asset::where('asset_code', $code)->first();

                return [$a, $a ? "$a->asset_code — $a->name_bn" : null, $a ? "/assets/$a->id" : null, 'asset.view'];
            case 'receipt':
                $r = Receipt::where('verify_token', $code)->first();

                return [$r, $r?->receipt_no, $r ? "/verify/receipt/$code" : null, null];
            case 'combined':
                $c = CombinedPayment::where('verify_token', $code)->first();

                return [$c, $c?->payment_no, $c ? "/verify/combined/$code" : null, null];
        }

        return [null, null, null, null];
    }
}
