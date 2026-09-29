import { t as tx } from './i18n'

/** `phase` for a whole-phase screen, `step` for one step of the savings restructure. */
export type SoonPage = { title: string; phase?: 9 | 10; step?: number; about: string; links?: { to: string; label: string }[] }

const savings = (title: string, step: number, about: string, links?: SoonPage['links']): SoonPage => ({ title, step, about, links })
const txns = [{ to: '/funds/savings/transactions', label: tx('সঞ্চয়ের লেনদেন') }]
const accounts = [{ to: '/funds/savings/accounts', label: tx('সঞ্চয় হিসাব') }]
const shares = [{ to: '/funds/share/transactions', label: tx('শেয়ারের লেনদেন') }]

/**
 * Menu items whose screen is not built yet: each opens a "coming soon" page (with the step and what to use meanwhile).
 * The savings group is being rebuilt step by step; its later leaves wait here until their step lands.
 */
export const SOON: Record<string, SoonPage> = {
  '/savings/withdrawals': savings(tx('উত্তোলনের তালিকা'), 2, tx('সঞ্চয় থেকে উত্তোলনের তালিকা, অবস্থা ও রশিদসহ।'), txns),
  '/savings/withdrawals/new': savings(tx('নতুন উত্তোলন'), 2, tx('সদস্যের সঞ্চয় থেকে উত্তোলনের আবেদন; ম্যানেজারের অনুমোদনের পরে পোস্ট হবে।'), txns),
  '/savings/withdrawals/approval': savings(tx('উত্তোলন অনুমোদন'), 2, tx('অপেক্ষমাণ উত্তোলনের আবেদন অনুমোদন বা বাতিল।'), [{ to: '/approvals', label: tx('অনুমোদন') }]),
  '/savings/shares': savings(tx('শেয়ার আদায়ের তালিকা'), 3, tx('সদস্যদের শেয়ার আদায়ের তালিকা।'), shares),
  '/savings/shares/new': savings(tx('নতুন শেয়ার আদায়'), 3, tx('সদস্যের কাছ থেকে শেয়ারের টাকা আদায়।'), shares),
  '/savings/shares/history': savings(tx('শেয়ার আদায়ের ইতিহাস'), 3, tx('শেয়ার আদায়ের প্রতিটি পরিবর্তনের ইতিহাস।'), shares),
  '/savings/accounts': savings(tx('সঞ্চয় হিসাবের তালিকা'), 4, tx('সকল সঞ্চয় হিসাব, জের ও অবস্থা।'), accounts),
  '/savings/accounts/open': savings(tx('হিসাব খোলা'), 4, tx('সদস্যের নামে নতুন সঞ্চয় হিসাব খোলা।'), accounts),
  '/savings/accounts/close': savings(tx('হিসাব বন্ধ'), 4, tx('জের শূন্য করে ম্যানেজারের অনুমোদনে হিসাব বন্ধ।'), accounts),
  '/savings/accounts/history': savings(tx('হিসাবের ইতিহাস'), 4, tx('হিসাব খোলা, বন্ধ ও পরিবর্তনের ইতিহাস।'), accounts),
  '/savings/statements/member': savings(tx('সদস্যের বিবরণী'), 5, tx('একজন সদস্যের সব হিসাবের বিবরণী।'), accounts),
  '/savings/statements/savings': savings(tx('সঞ্চয় বিবরণী'), 5, tx('সময়সীমা অনুযায়ী সঞ্চয় হিসাবের বিবরণী।'), accounts),
  '/savings/statements/share': savings(tx('শেয়ার বিবরণী'), 5, tx('সময়সীমা অনুযায়ী শেয়ার হিসাবের বিবরণী।'), [{ to: '/funds/share/accounts', label: tx('শেয়ার মূলধন বিবরণী') }]),
  '/savings/statements/combined': savings(tx('সম্মিলিত বিবরণী'), 5, tx('সঞ্চয়, শেয়ার, ঋণ ও সেচের বকেয়া এক বিবরণীতে।'), accounts),
  '/savings/reports/collection': savings(tx('আদায় রিপোর্ট'), 6, tx('সময়সীমা অনুযায়ী সঞ্চয় ও শেয়ার আদায়।'), [{ to: '/reports', label: tx('রিপোর্ট') }]),
  '/savings/reports/deposit': savings(tx('জমা রিপোর্ট'), 6, tx('সঞ্চয় জমার রিপোর্ট।'), [{ to: '/reports', label: tx('রিপোর্ট') }]),
  '/savings/reports/withdrawal': savings(tx('উত্তোলন রিপোর্ট'), 6, tx('সঞ্চয় উত্তোলনের রিপোর্ট।'), [{ to: '/reports', label: tx('রিপোর্ট') }]),
  '/savings/reports/balance': savings(tx('জের রিপোর্ট'), 6, tx('তারিখ অনুযায়ী সদস্যদের সঞ্চয়ের জের।'), [{ to: '/reports', label: tx('রিপোর্ট') }]),
  '/savings/reports/share': savings(tx('শেয়ার রিপোর্ট'), 6, tx('শেয়ার মূলধনের রিপোর্ট।'), [{ to: '/reports', label: tx('রিপোর্ট') }]),
  '/savings/audit/transactions': savings(tx('লেনদেন অডিট'), 7, tx('সঞ্চয় ও শেয়ারের লেনদেনের অডিট।'), [{ to: '/funds/savings/audit', label: tx('সঞ্চয় অডিট') }]),
  '/savings/audit/receipts': savings(tx('রশিদ অডিট'), 7, tx('বাতিল রশিদ, নম্বরের ফাঁক ও পুনর্মুদ্রণ।'), [{ to: '/funds/savings/audit', label: tx('সঞ্চয় অডিট') }]),
}
