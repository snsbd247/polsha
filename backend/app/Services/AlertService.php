<?php

namespace App\Services;

use App\Models\ApprovalRequest;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * Money left unattended, worked out on the spot for the top-bar bell: cash
 * days not closed, field collectors holding cash, approvals waiting too
 * long. Each alert goes only to people who can act on it and disappears as
 * soon as the cause is dealt with. The day limits are in System Preferences.
 */
class AlertService
{
    public function __construct(private DayCloseService $days, private FieldCollectionService $field) {}

    /** @return list<array{key:string, level:string, title:string, detail:string, link:string}> */
    public function for(User $user): array
    {
        $today = now()->startOfDay();
        $alerts = [];

        if ($user->can('cash.view')) {
            $limit = (int) SettingService::get('alert_day_close_days', 3);
            $open = $this->days->unclosedDays(400);
            $late = array_values(array_filter($open, fn ($d) => Carbon::parse($d)->lte($today->copy()->subDays($limit))));
            if ($late) {
                $alerts[] = [
                    'key' => 'day_close', 'level' => count($open) > 7 ? 'danger' : 'warning',
                    'title' => __(':n দিনের নগদ হিসাব বন্ধ (দিন বন্ধ) করা হয়নি', ['n' => count($open)]),
                    'detail' => __('সবচেয়ে পুরনো: :date — প্রতিদিনের নগদ গুনে দিন বন্ধ করুন।', ['date' => Carbon::parse($open[0])->format('d/m/Y')]),
                    'link' => '/cash/day-close',
                ];
            }
        }

        if ($user->can(['field.approve', 'field.view'])) {
            $limit = (int) SettingService::get('alert_field_cash_days', 2);
            foreach ($this->field->collectors() as $c) {
                if ($c['amount'] > 0 && $c['oldest'] && Carbon::parse($c['oldest'])->lte($today->copy()->subDays($limit))) {
                    $days = (int) Carbon::parse($c['oldest'])->diffInDays($today);
                    $alerts[] = [
                        'key' => 'field_cash_'.$c['id'], 'level' => $days > 7 ? 'danger' : 'warning',
                        'title' => __(':name-এর হাতে ৳:amount জমা হয়নি', ['name' => $c['name_bn'], 'amount' => number_format($c['amount'], 2)]),
                        'detail' => __(':date থেকে (:n দিন) মাঠের আদায় অফিসে জমা পড়েনি।', ['date' => Carbon::parse($c['oldest'])->format('d/m/Y'), 'n' => $days]),
                        'link' => '/payments/field',
                    ];
                }
            }
        }

        $limit = (int) SettingService::get('alert_approval_days', 3);
        $q = ApprovalRequest::where('requested_by', '!=', $user->id)->where('created_at', '<=', now()->subDays($limit));
        $q = $user->isSuperAdmin() ? $q->where('status', ApprovalRequest::PENDING) : $q->awaitingRoles($user->getRoleNames()->all());
        $stuck = (clone $q)->count();
        if ($stuck > 0) {
            $oldest = (clone $q)->min('created_at');
            $alerts[] = [
                'key' => 'approvals', 'level' => 'warning',
                'title' => __(':n টি অনুমোদন :d দিনের বেশি আটকে আছে', ['n' => $stuck, 'd' => $limit]),
                'detail' => __('সবচেয়ে পুরনোটি :date থেকে আপনার সিদ্ধান্তের অপেক্ষায়।', ['date' => Carbon::parse($oldest)->format('d/m/Y')]),
                'link' => '/approvals',
            ];
        }

        return $alerts;
    }
}
