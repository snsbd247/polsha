<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ReceiptBook;
use App\Models\User;
use App\Support\Tr;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Printed (manual) receipt books: which serial range went to which
 * collector, and which numbers inside a book were never entered in the
 * system (a gap may mean a lost or unrecorded receipt).
 */
class ReceiptBookController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $q = ReceiptBook::with('holder:id,name_bn,name_en')->orderByDesc('id');
        $request->filled('status') && $q->where('status', $request->query('status'));
        $books = $q->paginate($this->perPage($request));
        $books->getCollection()->transform(fn (ReceiptBook $b) => $b->toArray() + $this->usage($b, false));

        return response()->json($books->toArray() + [
            'statuses' => Tr::map(ReceiptBook::STATUSES),
            'users' => User::where('is_active', true)->orderBy('name_bn')->get(['id', 'name_bn', 'name_en']),
            'sequences' => DB::table('sequences')->whereIn('key', ['receipt', 'combined_payment', 'loan_payment', 'public_payment'])
                ->get(['key', 'label', 'prefix', 'next_value', 'current_year']),
            // the cards: books per status (stock / issued / closed / lost)
            'status_counts' => ReceiptBook::query()->selectRaw('status, COUNT(*) n')->groupBy('status')->pluck('n', 'status'),
        ]);
    }

    public function show(ReceiptBook $receiptBook): JsonResponse
    {
        return response()->json($receiptBook->load('holder:id,name_bn,name_en')->toArray() + $this->usage($receiptBook, true));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);

        return response()->json(ReceiptBook::create($data), 201);
    }

    public function update(Request $request, ReceiptBook $receiptBook): JsonResponse
    {
        $receiptBook->update($this->validated($request, $receiptBook));

        return response()->json($receiptBook);
    }

    private function validated(Request $request, ?ReceiptBook $book = null): array
    {
        $data = $request->validate([
            'book_no' => ['required', 'string', 'max:30', Rule::unique('receipt_books')->ignore($book?->id)],
            'start_no' => ['required', 'integer', 'min:1'],
            'end_no' => ['required', 'integer', 'gte:start_no', 'lte:'.((int) $request->input('start_no') + 9999)],
            'issued_to' => ['nullable', 'exists:users,id'],
            'issued_on' => ['nullable', 'date'],
            'status' => ['required', 'in:'.implode(',', array_keys(ReceiptBook::STATUSES))],
            'note' => ['nullable', 'string', 'max:300'],
        ]);
        $overlap = ReceiptBook::when($book, fn ($q) => $q->whereKeyNot($book->id))
            ->where('start_no', '<=', $data['end_no'])->where('end_no', '>=', $data['start_no'])->value('book_no');
        if ($overlap) {
            throw ValidationException::withMessages(['start_no' => __('এই সিরিয়াল বই :no-এর সাথে মিলে যায়।', ['no' => $overlap])]);
        }
        if ($data['status'] === 'issued' && empty($data['issued_to'])) {
            throw ValidationException::withMessages(['issued_to' => __('কাকে দেওয়া হয়েছে তা বাছাই করুন।')]);
        }

        return $data;
    }

    /** Numbers of this book used as the manual (old) receipt number on receipts. */
    private function usage(ReceiptBook $book, bool $details): array
    {
        $used = DB::table('receipts')->whereNotNull('legacy_no')
            ->get(['id', 'receipt_no', 'legacy_no', 'date', 'amount', 'status'])
            ->filter(function ($r) use ($book) {
                $n = trim((string) $r->legacy_no);

                return ctype_digit($n) && (int) $n >= $book->start_no && (int) $n <= $book->end_no;
            });
        $numbers = $used->map(fn ($r) => (int) $r->legacy_no)->unique()->sort()->values();
        $last = $numbers->last();
        $gaps = [];
        if ($last) {
            $set = array_flip($numbers->all());
            for ($n = $book->start_no; $n < $last; $n++) {
                isset($set[$n]) || $gaps[] = $n;
            }
        }
        $total = $book->end_no - $book->start_no + 1;
        $out = ['total' => $total, 'used' => $numbers->count(), 'remaining' => $total - $numbers->count(), 'last_used' => $last, 'gap_count' => count($gaps)];
        if ($details) {
            $out['gaps'] = array_slice($gaps, 0, 500);
            $out['receipts'] = $used->sortBy(fn ($r) => (int) $r->legacy_no)->values();
            $out['duplicates'] = $used->groupBy('legacy_no')->filter(fn ($g) => $g->count() > 1)->keys()->values();
        }

        return $out;
    }
}
