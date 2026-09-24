import { t as tx } from './i18n'

export type SoonPage = { title: string; phase: 9 | 10; about: string; links?: { to: string; label: string }[] }

/** Menu items whose screen is not built yet: each opens a "coming soon" page (with the phase and what to use meanwhile). */
export const SOON: Record<string, SoonPage> = {
  '/imports/savings-opening': { title: tx('সঞ্চয়ের প্রারম্ভিক ইমপোর্ট'), phase: 10, about: tx('পুরোনো খাতার সঞ্চয় জের একসাথে ইমপোর্ট।') },
  '/imports/share-opening': { title: tx('শেয়ারের প্রারম্ভিক ইমপোর্ট'), phase: 10, about: tx('পুরোনো খাতার শেয়ার জের একসাথে ইমপোর্ট।') },
  '/imports/loan-opening': { title: tx('ঋণের প্রারম্ভিক ইমপোর্ট'), phase: 10, about: tx('চলমান পুরোনো ঋণ ও বকেয়া একসাথে ইমপোর্ট।') },
  '/imports/payments': { title: tx('পেমেন্ট ইমপোর্ট'), phase: 10, about: tx('পুরোনো আদায়ের তথ্য একসাথে ইমপোর্ট।'), links: [{ to: '/payments/collect?legacy=1', label: tx('পুরোনো রশিদ এন্ট্রি') }] },
  '/imports/legacy-irrigation': { title: tx('পুরোনো সেচ ডেটা ইমপোর্ট'), phase: 10, about: tx('আগের মৌসুমের সেচ ইনভয়েস ও আদায় ইমপোর্ট।') },
  '/imports/audit': { title: tx('ইমপোর্ট অডিট'), phase: 10, about: tx('সব ইমপোর্টের ব্যাচ, ফলাফল ও বাদ পড়া সারি।'), links: [{ to: '/imports', label: tx('ইমপোর্টের ইতিহাস') }] },
  '/settings/branding': { title: tx('ব্র্যান্ডিং ও লোগো'), phase: 10, about: tx('লোগো, রং ও রশিদ/রিপোর্টের শিরোনাম আলাদা পাতায়।'), links: [{ to: '/settings/general', label: tx('সাধারণ সেটিংস (লোগো)') }] },
  '/settings/receipt': { title: tx('রশিদ সেটিংস'), phase: 10, about: tx('রশিদের নকশা, কপি সংখ্যা, পাদটীকা ও প্রিন্টার।'), links: [{ to: '/settings/general', label: tx('সাধারণ সেটিংস') }] },
  '/settings/preferences': { title: tx('সিস্টেম পছন্দসমূহ'), phase: 10, about: tx('তারিখ/অঙ্কের ধরন, ডিফল্ট ভাষা ও অন্যান্য পছন্দ।'), links: [{ to: '/settings/general', label: tx('সাধারণ সেটিংস') }] },
  '/settings/license': { title: tx('লাইসেন্স ও ইনস্টলেশন'), phase: 10, about: tx('লাইসেন্সের তথ্য, সংস্করণ ও আপডেট।') },
}
