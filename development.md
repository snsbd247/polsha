# Development — পল্লী সমবায় সমিতি + কৃষি সেচ ERP (Polsha)

> এই প্রজেক্ট কবে, কোন ক্রমে, কীভাবে তৈরি হয়েছে — git history (৮৯টি commit), README-এর অগ্রগতির অংশ ও সার্ভারের কাজের লগ থেকে।
> পরিকল্পনা [plan.md](plan.md)-এ, ডাটাবেজ [Database.md](Database.md)-এ, UI [UI.md](UI.md)-এ, এই প্রজেক্টের কথোপকথন [chat_history.md](chat_history.md)-এ।

## এক নজরে

| বিষয় | মান |
|---|---|
| রিপোজিটরি | https://github.com/snsbd247/polsha (branch `main`) |
| প্রথম commit | ২৩/০৯/২০২৬ — Phase 1 |
| শেষ commit | ২৪/১১/২০২৬ — লিফট অনুযায়ী সেচের রেট (ফেজ ১৩) |
| মোট commit | ৯৭ (Md Ismail Hosain-এর নামে; ২৪/১১ থেকে Claude সহ-লেখক) |
| কোডের পরিবর্তন | ১,৮৬১ বার ফাইল বদল, +১,৪৭,৪৮১ / −২০,০০৮ লাইন; এখন ৬৯৯টি ফাইল |
| Feature test | ১৯৭টি test (২৯টি ফাইল) — ২৫/১১/২০২৬-এর পূর্ণ রানে সব পাস (২,৮৯৪ assertion) |
| ডাটাবেজ | ৬০টি migration, ১০৪টি টেবিল |
| প্রথম লাইভ | https://smartirrigation.click (২৩/০৯/২০২৬) |
| এখনকার লাইভ | https://pmpbssl.com (cPanel `pmwmcs`, ১৫/১০/২০২৬ থেকে; সার্ভার ২৪/১১-এর আগে `169.40.116.146`-এ সরেছে) |

**সময়রেখা:**

```
২৩/০৯ ─ ফেজ ১, ২, cPanel deploy
২৪/০৯ ─ ফেজ ৩, ৩ক, ৪, ৫, ৬, ৭, ৮
২৫/০৯ ─ ফেজ ৯, ১০ → নকশা-স্যাম্পল অনুযায়ী পুনর্নির্মাণ শুরু (ড্যাশবোর্ড, কৃষক তালিকা)
২৬/০৯–০১/১০ ─ সব মেন্যুর পাতা অনুমোদিত নকশায় + এক বছরের ডেমো ডাটা
০১/১০–০৪/১০ ─ সমিতির সিদ্ধান্তে "সহজ" মডিউল (ঋণ, নগদ, সেচ, কৃষক, জমি, সম্পদ, হিসাব), মাঠে আদায়, Bell সতর্কতা
০৪/১০ ─ ফেজ ১১ ওয়েবসাইট, ফেজ ১২ পানি সরবরাহ, সারা দেশের এলাকা, সাব-পাথ (XAMPP)
০৫/১০–০৭/১০ ─ ওয়েবসাইটের হোমপেজ, পানির পাতাগুলোর নকশা, রেস্পন্সিভ
১৫/১০ ─ অনলাইন লাইসেন্স, সবসময় HTTPS → pmpbssl.com
২৯/১০ ─ ওয়েবসাইট আলাদা পাতায়, যোগাযোগের ইনবক্স
০৫/১১ ─ লোকাল XAMPP-এ লাইভের কপি
২৪/১১ ─ নতুন সার্ভার থেকে লোকাল ডেটা হালনাগাদ, এই ৫টি ডকুমেন্ট
২৪/১১ ─ ফেজ ১৩: লিফট অনুযায়ী সেচের রেট → GitHub ও লাইভে deploy
২৪–২৫/১১ ─ ফেজ ১৪: সমিতির কাগজের নকশায় রিপোর্ট (জমা-খরচ বিবরণী, এক নজরে), রশিদ ও ভাউচার, আবেদন ফর্ম → তিন ধাপে লাইভে
```

---

## ১. ফেজভিত্তিক ইতিহাস

### ফেজ ১ — ভিত্তি, প্রশাসন ও অনুমোদন (২৩/০৯/২০২৬)
- Laravel 12 + Sanctum + spatie/laravel-permission; React + Vite + TypeScript + Ant Design 6 + TanStack Query।
- লগইন (ইউজারনেম/মোবাইল, ৫ বার ভুলে লক, প্রথম লগইনে পাসওয়ার্ড বদল), ইউজার, Role (১২টি) ও Permission Matrix (২৫ মডিউল × ৭ action), Auditable trait, বহু ধাপের Approval Engine, এলাকা ও মৌজা, Settings, Sequence, দৈনিক ব্যাকআপ।
- ১৫টি feature test।
- একই দিনে cPanel-এ প্রথম deploy: একই ডোমেইনের `/api` পথে `laravel.php` front controller ও `deploy/server-deploy.sh`।

### ফেজ ২ — কৃষক, সদস্য ও পাতওয়ারী (২৩/০৯)
- কৃষক (৭ ট্যাবের প্রোফাইল), ডকুমেন্ট, খানা, Duplicate Detection, Farmer Merge, সদস্যপদ আবেদন (Manager → President), সদস্য তালিকা ও অবস্থা পরিবর্তন, ভর্তি রেজিস্টার, ভোটার তালিকা, পাতওয়ারী।
- নকশা থেকে পরিবর্তন: আলাদা `farmer_merges` টেবিলের বদলে Approval payload + Audit; `patwari_mouza_assignments` (শুরু/শেষ তারিখ)।
- মোট ৩১টি test।

### ফেজ ৩ ও ৩ক — জমি, বর্গা, Data Health; দ্বিভাষিক (২৪/০৯)
- জমি (শতকে সংরক্ষণ, বহু একক), মালিকানা (অংশ ১০০%), চাষ (নিজ/বর্গা/লিজ), হস্তান্তর, Data Health (১৩টি যাচাই), কৃষক ও জমির CSV Import।
- বাংলা/English toggle: frontend-এর ৬৬৩টি লেখা, backend-এর ২৯৩টি key; `X-Locale` header; i18n check/wrap script।
- মোট ৪২টি test।

### ফেজ ৪–৮ — টাকার মডিউল (২৪/০৯)
- **৪:** Chart of Accounts, জার্নাল/ভাউচার, Posting Engine (`LedgerService`), আলাদা Cash Stream, ব্যাংক ও FDR, Opening Balance, Accounting Period, GL/Cash Book/Trial Balance (৫২টি test)।
- **৫:** মৌসুম, সেচের ধরন, রেট (অনুমোদনসহ), ইনভয়েস (একক/Bulk, Snapshot), Receipt Engine, বকেয়া, Due Mismatch, Rate Audit (৬১টি)।
- **৬:** সঞ্চয় ও শেয়ার, মুনাফা ও লভ্যাংশ বণ্টন, Statement, Savings Audit, Share Capital Reconciliation (৬৭টি)।
- **৭:** ঋণের প্ল্যান, আবেদন → বিতরণ → কিস্তি, জামিনদার, জরিমানা, Aging, ঋণ অডিট (৭১টি)।
- **৮:** Combined Payment, Day Reconciliation, Bank Reconciliation, QR, পুরো সম্পদ মডিউল, সমিতির হুবহু ১৫-গ্রুপ মেন্যু (৭৭টি)।

### ফেজ ৯–১০ — রিপোর্ট ও Go-Live প্রস্তুতি (২৫/০৯)
- **৯:** ৫৮টি রিপোর্ট, ড্যাশবোর্ড, রাতের Integrity Scan, Ledger Integrity, SMS, Public Payment (`/pay`), Receipt Serial Admin, অর্থবছর বন্ধ (৮৭টি)।
- **১০:** Import Wizard ও Rollback, নকশা (লোগো, স্বাক্ষর, সিল, রশিদের কাগজ, সদস্য কার্ড), License, System Preferences, নিরাপত্তা পর্যালোচনা, [docs/user-guide.md](docs/user-guide.md) ও [docs/go-live-checklist.md](docs/go-live-checklist.md) (৯৬টি)।

### নকশা-স্যাম্পল অনুযায়ী পুনর্নির্মাণ (২৫/০৯ – ০১/১০)
সমিতি প্রতিটি পাতার নমুনা ছবি দেয়; প্রতিটি পাতা "পিক্সেল টু পিক্সেল" সেই অনুযায়ী আবার তৈরি হয়, প্রতিটির feature test-সহ:
- ড্যাশবোর্ড ও গাঢ় নীল সাইডবার → কৃষক তালিকা → কৃষক প্রোফাইল (১১ ট্যাব), সাধারণ সেটিংস, কৃষক ফর্ম → সদস্যপদ আবেদন ফর্ম ও তালিকা → সদস্য, ভোটার, মার্জ, মুছে ফেলা, পাতওয়ারী, মৌজা, জমির প্রোফাইল।
- পুরো জমি মেন্যু (তালিকা, ফর্ম, মালিক ও চাষি, বর্গা, হস্তান্তর, ইতিহাস, ধরন, রিপোর্ট)।
- সেচ (১৭টি স্যাম্পল), সঞ্চয়, ঋণ, নগদ ও পেমেন্ট, ক্যাশ বই, সম্পদ, হিসাব (১৪ পাতা), রিপোর্ট/অডিট, প্রশাসন, ইমপোর্ট, বাকি সব ছোট পাতা।
- ২৯/০৯: সব পাতা থেকে শিরোনাম ও বর্ণনা সরানো — ব্রেডক্রাম্বই পাতার নাম।
- ২৬/০৯ ও ০১/১০: `demo:seed --farmers=100` — এক বছরের সব মডিউলের ডাটা, সিস্টেমের নিজের API দিয়ে; `demo:purge` আগের অবস্থায় ফেরায়। ডেমো ডাটা অনেকগুলো bug ধরিয়ে দেয়, সেগুলো ঠিক করা হয়।
- ২৯/০৯: নিরাপদ deploy (প্যাকেজ আগে যাচাই), সার্ভারের বাইরে ব্যাকআপ (ইমেইল), রশিদ পুনর্মুদ্রণের লগ, দ্রুত প্রথম লোড।

### "সহজ" মডিউল — সমিতির সিদ্ধান্তে (০১/১০ – ০৪/১০)
ব্যবহার করে দেখার পর সমিতি কম মেন্যু ও কম ধাপ চায়:
- ঋণ: ১১ → ৬ মেন্যু, এক ঋণের সব এক পাতায় ট্যাবে, "কিস্তি আদায়" এক স্ক্রিন, নতুন প্ল্যানে শুধু ফ্ল্যাট সুদ, জরিমানা প্রতি কিস্তিতে একবার।
- নগদ ও পেমেন্ট: এক "টাকা আদায়" স্ক্রিন, এক রশিদ পাতা।
- মাঠকর্মীর মোবাইল আদায় ও অফিসে জমা (০২/১০), টাকা পড়ে থাকলে Bell সতর্কতা।
- সেচ: ৬ মেন্যু, রেট ও বিলিং এক পাতায়, আগের মৌসুমের রেট কপি।
- নগদ বিবরণী ও আয়-ব্যয় বই অডিট শিট/কাগজের খাতার ধাঁচে; রশিদ সমিতির কাগজের স্লিপের মতো।
- কৃষক, সদস্য, জমি, সম্পদ, হিসাব সহজ করা — সাইড মেন্যু অপরিবর্তিত।

### ফেজ ১১ ও ১২ — ওয়েবসাইট ও পানি সরবরাহ (০৪/১০ – ০৭/১০)
- বাংলাদেশের সব বিভাগ/জেলা/উপজেলা/ইউনিয়ন; গ্রাম ও মৌজা ফর্ম থেকে।
- নিরাপত্তা সংশোধন: অনলাইন পেমেন্টের অবস্থা দেখতে পুরো মোবাইল নম্বর।
- অ্যাপ সাব-পাথেও চলে (লোকাল XAMPP `/polsha`)।
- পাবলিক ওয়েবসাইট মূল ঠিকানায়, Settings → ওয়েবসাইট থেকে সম্পাদনা; ০৫/১০ নমুনা অনুযায়ী নতুন হোমপেজ।
- পানি সরবরাহ: সংযোগ, নির্দিষ্ট মাসিক বিল, জরিমানাসহ আদায় — একই দিনে লাইভে (আগে ব্যাকআপ `polsha-20261004-202947.sql.gz`)।
- ফেজ ১২ক: পানির বিল কাউন্টার, মাঠ, অনলাইন, রিপোর্ট, SMS, ইমপোর্ট — সব জায়গায়; মোট ১৬৭টি test পাস।
- ০৫/১০: রেস্পন্সিভ — ১৪৩টি পাতা ও ওয়েবসাইট ৩৬০/৭৬৮/১১০০px-এ; ০৫–০৭/১০ পানির সব পাতা নতুন নকশায়।

### লাইসেন্স, HTTPS ও নতুন ডোমেইন (১৫/১০)
- আগের অফলাইন লাইসেন্স (চালু/বন্ধ সুইচসহ) বাদ; SNS লাইসেন্স সার্ভারে অনলাইন যাচাই, RSA স্বাক্ষর, ডোমেইনে বাঁধা, বন্ধ করার সুইচ নেই।
- সার্ভার rate-limit (429) দিলে "অফলাইন" ধরা হয়, "অবৈধ" নয়।
- `http://` → `https://` স্থায়ী (301)।
- লাইভ এখন `pmpbssl.com` (cPanel `pmwmcs`)।

### ওয়েবসাইট আলাদা পাতায় (২৯/১০)
- মেন্যুর প্রতিটি ঘরের নিজের ঠিকানা (হোম, পরিচিতি, সেবা, নোটিশ, গ্যালারি, FAQ, যোগাযোগ)।
- যোগাযোগের ফর্মের বার্তা Settings → ওয়েবসাইটের বার্তা-য়; সভাপতির বাণী, নোটিশের পুরো লেখা ও PDF সংযুক্তি।
- এটাই সর্বশেষ commit (`ef47dba`), লাইভেও এই কোড চলছে।

---

## ২. সার্ভার ও পরিবেশের কাজ (git-এর বাইরে)

| তারিখ | কাজ |
|---|---|
| ২৩/০৯/২০২৬ | প্রথম লাইভ: https://smartirrigation.click (`/home/smartirrigation`, DB `smartirrigation_irrigdb`) |
| ০৪/১০/২০২৬ | লোকাল XAMPP-এ লাইভের ডাটাবেজ (`F:\Lovable\polsha-db\live-20261004-1835.sql.gz`), সাব-পাথ build `F:\Lovable\polsha-web` |
| ১৫/১০/২০২৬ | নতুন cPanel অ্যাকাউন্ট `pmwmcs`, ডোমেইন https://pmpbssl.com, DB `pmwmcs_polsha`; শেষ release ২৯/১০ |
| ০৫/১১/২০২৬ | লাইভ (`163.227.239.146`) থেকে ডাটাবেজ ও আপলোড করা ফাইল লোকালে; XAMPP-এ `Alias /polsha` (`conf/extra/httpd-polsha.conf`), PHP-তে `intl`/`gd`/`zip` চালু, backend `.env`-এ পোর্ট 3306 ও তিনটি ঠিকানা; localhost / 192.168.0.171 / 160.25.9.132 থেকে যাচাই। কোড লাইভ ও লোকালে একই (hash মিলিয়ে দেখা) |
| ২৪/১১/২০২৬ | পুরোনো IP বন্ধ — লাইভ সরেছে `169.40.116.146`-এ (srv3.syncsolutionbd.com); সেখান থেকে নতুন ডাটাবেজ ও ফাইল লোকালে (আগের লোকাল DB-র ব্যাকআপ রেখে); কোড এখনো একই। Database.md, plan.md, UI.md, chat_history.md, development.md তৈরি |
| ২৪/১১/২০২৬ | ফেজ ১৩ (লিফট অনুযায়ী সেচের রেট) — commit `64e5783`, GitHub-এ push; `server-deploy.sh` দিয়ে লাইভে: আগে ব্যাকআপ `polsha-20261124-145912.sql.gz`, migration `2026_11_24_100000_irrigation_lifts`, নতুন bundle `index-BOLA9UZ1.js`; লাইভে ৩টি লিফট, সেদিনের লগে কোনো error নেই। লোকাল XAMPP-এও একই build (`F:\Lovable\polsha-web`) ও migration |
| ২৪/১১/২০২৬ | লিফট কমানো ও সব জমিতে একই রেট — commit `6f17e8b`, লাইভে deploy (আগে ব্যাকআপ `polsha-20261124-221134.sql.gz`, নতুন migration নেই, bundle `index-heLDja10.js`); লোকালেও নতুন build |
| ২৪–২৫/১১/২০২৬ | ফেজ ১৪ (সমিতির ১২টি কাগজের নকশা) তিন ধাপে, প্রতিবার আগে ব্যাকআপ নিয়ে লাইভে: ধাপ ১ `3a39307` (জমা-খরচ বিবরণী ও এক নজরে; migration `statement_heads`, ১৮৬টি খাত, ১২৩টি নতুন হিসাব), ধাপ ২ `7ce0975` (সেচ/পানি/শেয়ার-সঞ্চয় রশিদ, ক্যাশ ক্রেডিট ভাউচার; migration `water_ward_and_commitment_fee`), ধাপ ৩ `4e38300` (সদস্যপদ ও ঋণের আবেদন, অঙ্গীকারনামা, উত্তোলনের আবেদন; migration `paper_form_fields`); শেষ bundle `index-BnErWoyO.js`। প্রিন্টের নকশা headless Chrome-এ PDF বানিয়ে যাচাই করা |

**লোকালে যা বাকি:** লোকাল ডোমেইনের লাইসেন্স key (এখন `pmpbssl.com`-এ বাঁধা, তাই লোকালে signed-in কাজ বন্ধ)। Windows Firewall-এ পোর্ট 80 খোলা হয়েছে ২৪/১১/২০২৬-এ।

---

## ৩. যেভাবে কাজ হয়েছে (রীতি)

- **ফেজ ধরে:** প্রতিটি ফেজের "সম্পন্ন হওয়ার শর্ত" README-তে আগে লেখা, তারপর কাজ; শর্ত পূরণ হলে ✅।
- **প্রতিটি পরিবর্তনে feature test** (`backend/tests/Feature`) — test-এর সংখ্যা ১৫ থেকে ১৮৩-এ।
- **ব্রাউজারে পুরো flow যাচাই** প্রতিটি ফেজে (যেমন ইনভয়েস → আদায় → রশিদ → বাতিল → লেজার মিল), English মোড স্ক্যান, মোবাইল স্ক্যান।
- **নকশা-স্যাম্পল:** সমিতি নমুনা ছবি দেয়, পাতা হুবহু সেভাবে; সমিতির সিদ্ধান্তে পরে সহজ করা।
- **দ্বিভাষিক শুরু থেকেই** (ফেজ ৪ থেকে প্রতিটি নতুন স্ক্রিন)।
- **ডেমো ডাটা** দিয়ে সব মডিউল একসাথে চালিয়ে bug ধরা।
- **Deploy:** আগে ব্যাকআপ, প্যাকেজ যাচাই, পুরোনো release রেখে (`backend.old`)।
- **Commit message** ইংরেজিতে, এক লাইনে কী বদলেছে।

---

## ৪. সব commit (পুরোনো থেকে নতুন)

| # | তারিখ | Commit | বিবরণ | ফাইল | লাইন |
|---:|---|---|---|---:|---|
| 1 | 23/09/2026 | `104044f` | Phase 1: foundation, admin, audit and approval engine | 164 | +21075 / -0 |
| 2 | 23/09/2026 | `eecac35` | Phase 2: farmers, membership and patwari | 61 | +5657 / -23 |
| 3 | 23/09/2026 | `f65a97e` | Deploy to cPanel: same-origin /api front controller and deploy script | 7 | +185 / -35 |
| 4 | 24/09/2026 | `288185c` | Phase 3: land, borga, data health and CSV import | 38 | +3215 / -17 |
| 5 | 24/09/2026 | `bfad03a` | Phase 3a: bilingual UI (Bangla / English) with a language toggle | 102 | +3306 / -1167 |
| 6 | 24/09/2026 | `6da90ab` | Phase 4: accounting backbone, cash and bank | 43 | +3659 / -20 |
| 7 | 24/09/2026 | `80d8de5` | Phase 5: irrigation billing, receipts and dues | 69 | +5484 / -56 |
| 8 | 24/09/2026 | `81626f2` | Phase 6: savings and share — accounts, deposits, withdrawals, transfers, profit and dividend distribution | 37 | +3432 / -28 |
| 9 | 24/09/2026 | `b8e02dd` | Phase 7: loans — products, applications, disbursement, schedules, penalty, repayments and aging | 40 | +3985 / -16 |
| 10 | 24/09/2026 | `c339b87` | Phase 8: combined payment, day close, bank reconciliation, QR, assets + full 15-group menu | 85 | +8045 / -164 |
| 11 | 25/09/2026 | `217e127` | Phase 9: reports, dashboard, integrity scan, SMS, public payments, financial year | 63 | +7263 / -110 |
| 12 | 25/09/2026 | `d200e3a` | Phase 10: import/migration, rollback, license, branding and go-live docs | 68 | +4476 / -421 |
| 13 | 25/09/2026 | `c3fae49` | Dashboard redesign to match the approved sample | 18 | +3182 / -537 |
| 14 | 25/09/2026 | `3201e7b` | Farmer list redesign to match the approved sample | 13 | +1808 / -1162 |
| 15 | 26/09/2026 | `7afd82c` | Redesign farmer profile, general settings and farmer form to the approved samples | 39 | +4378 / -715 |
| 16 | 26/09/2026 | `0abe92d` | Redesign new membership application form to the approved sample | 8 | +1375 / -169 |
| 17 | 26/09/2026 | `bc58a02` | Redesign membership application list to the approved sample | 9 | +1174 / -82 |
| 18 | 26/09/2026 | `157863f` | Add one-year demo data (demo:seed / demo:purge) and fix bugs it found | 10 | +934 / -32 |
| 19 | 26/09/2026 | `084ab45` | Remove Add Farmer from the sidebar menu | 2 | +1 / -6 |
| 20 | 26/09/2026 | `886516b` | Remove the application details panel from the membership application list | 3 | +8 / -638 |
| 21 | 26/09/2026 | `e49f1bf` | Redesign member, voter, merge, deleted, patwari, mouza and land profile pages | 43 | +5764 / -892 |
| 22 | 27/09/2026 | `fcea43f` | demo:purge brings the schema up to date after restoring the snapshot | 1 | +23 / -0 |
| 23 | 27/09/2026 | `3ee6e38` | Redesign the rest of the Land menu in the approved list style | 16 | +2006 / -39 |
| 24 | 27/09/2026 | `bbcbf0e` | Tell the sender why a pending approval has no buttons | 2 | +19 / -2 |
| 25 | 27/09/2026 | `27b935c` | A Super Admin's farmer merge applies without approval | 5 | +58 / -5 |
| 26 | 27/09/2026 | `3766af7` | Make the dashboard and list pages fit every screen size | 5 | +186 / -23 |
| 27 | 27/09/2026 | `3d2c8e8` | Redesign the land list to the approved sample | 8 | +473 / -94 |
| 28 | 27/09/2026 | `1fee7ad` | Redesign the add/edit land form to the approved sample | 12 | +1198 / -147 |
| 29 | 27/09/2026 | `e46a31d` | Redesign Owner & Cultivator to the approved sample | 5 | +216 / -129 |
| 30 | 27/09/2026 | `ded651e` | Redesign Borga / Sharecropping to the approved sample | 14 | +380 / -121 |
| 31 | 27/09/2026 | `0759936` | Add the land transfer form, detail and list pages to the approved samples | 23 | +1837 / -92 |
| 32 | 27/09/2026 | `aa2f709` | List the remaining work in the README | 1 | +42 / -4 |
| 33 | 28/09/2026 | `2a08290` | Add the farmer merge list page to the approved sample | 18 | +802 / -59 |
| 34 | 29/09/2026 | `3643466` | Redesign Land History as the activity list from the approved sample | 11 | +793 / -158 |
| 35 | 29/09/2026 | `12d0b5c` | Add one land's history, and redesign Land Types and Land Reports to the samples | 25 | +2278 / -256 |
| 36 | 29/09/2026 | `d1ffda7` | Match the earlier pages to the samples: header buttons, card labels, transfer icons | 3 | +26 / -5 |
| 37 | 29/09/2026 | `7e04d5c` | Redesign seasons to the samples: list, add/edit form and season details | 17 | +1097 / -113 |
| 38 | 29/09/2026 | `99e4ecf` | Redesign irrigation invoice list, create form and details to the samples; invoices take extra charges and a discount | 15 | +1297 / -361 |
| 39 | 29/09/2026 | `010eaf7` | Redesign bulk irrigation invoices to the sample; bulk runs can be narrowed to one source and chosen plots | 6 | +487 / -177 |
| 40 | 29/09/2026 | `277497a` | Redesign irrigation charge collection to the sample: pick due invoices of any farmers, one receipt per farmer in one step | 8 | +722 / -3 |
| 41 | 29/09/2026 | `8e0c82d` | Redesign irrigation rates, rate proposal, category rates, irrigation types and rate audit history to the samples | 18 | +1400 / -398 |
| 42 | 29/09/2026 | `195702b` | Add the old receipt list and redesign old receipt entry to the samples | 9 | +646 / -243 |
| 43 | 29/09/2026 | `fc53570` | Redesign due mismatch and season / land-type lookup to the samples; per-invoice collection check | 10 | +781 / -69 |
| 44 | 29/09/2026 | `0a05afc` | Remove page titles and their descriptions from every page; the breadcrumb names the page | 3 | +54 / -0 |
| 45 | 29/09/2026 | `7933421` | Demo data: seasons carry code and type; restoring a snapshot copes with a table its migrations do not record; seeding waits for pending migrations | 1 | +19 / -1 |
| 46 | 29/09/2026 | `8e15250` | Savings step 1: three-level savings menu and the savings entry pages | 24 | +1887 / -168 |
| 47 | 29/09/2026 | `0f5dd42` | Safer deploys, off-site backups, reprint log, lighter first load | 28 | +652 / -74 |
| 48 | 29/09/2026 | `dc53ddf` | Deploy check: read the whole archive listing so pipefail does not trip on grep -q | 1 | +1 / -1 |
| 49 | 30/09/2026 | `6356268` | Savings: six flat pages; accounts open with the membership | 40 | +2099 / -609 |
| 50 | 30/09/2026 | `0901fec` | Loans in the approved design: lists, application, detail, receipt, plans | 13 | +1536 / -700 |
| 51 | 30/09/2026 | `3d2d6c3` | Cash & Payments in the approved design: lists, receipts, combined form, cash book, day close, QR | 27 | +2418 / -1049 |
| 52 | 30/09/2026 | `0b985b4` | Cash Book & Ledger in the approved design: cash statements, income-expense book, export audit | 10 | +662 / -8 |
| 53 | 30/09/2026 | `36220e7` | Assets in the approved design: dashboard, register, moves, repair schedule, detail, form, reports | 17 | +1978 / -990 |
| 54 | 30/09/2026 | `faf49e3` | Accounting in the approved design: vouchers, journal form, chart of accounts, banks, reconciliation, reports | 25 | +1815 / -817 |
| 55 | 01/10/2026 | `db0026f` | Finish the redesign: reports, audit, admin, imports and every remaining page | 49 | +1964 / -1018 |
| 56 | 01/10/2026 | `3aadffa` | Demo data for every module: 100 farmers, one year | 3 | +687 / -17 |
| 57 | 01/10/2026 | `feb77ae` | Simpler loans: 6 menu items, one loan page with tabs, collect-instalment screen | 26 | +798 / -422 |
| 58 | 02/10/2026 | `5c686de` | Field collection on a phone, with hand-in at the office | 20 | +1406 / -8 |
| 59 | 02/10/2026 | `8c31c32` | Bell alerts for money left unattended | 13 | +342 / -16 |
| 60 | 02/10/2026 | `b929201` | Simpler Cash & Payments: one Collect Money screen, one Receipts page | 16 | +527 / -255 |
| 61 | 03/10/2026 | `64b7723` | Simpler irrigation: 6 menu items, rates and billing on one page each, copy last season's rates | 22 | +644 / -98 |
| 62 | 03/10/2026 | `d83a79a` | Irrigation cash statement laid out like the audit sheet | 11 | +514 / -3 |
| 63 | 03/10/2026 | `4a89e4d` | Society cash statement laid out like the audit sheet, with the bank accounts | 12 | +229 / -230 |
| 64 | 03/10/2026 | `134c16a` | Income-expense cash books for the society and irrigation, laid out like the paper book | 13 | +830 / -6 |
| 65 | 03/10/2026 | `3b1310e` | Demo data fills this month and the empty screens | 1 | +92 / -6 |
| 66 | 03/10/2026 | `7df88b4` | Receipts printed like the society's paper slip | 13 | +586 / -580 |
| 67 | 03/10/2026 | `e7f9c61` | Simpler farmers, members and land, side menu unchanged | 29 | +1564 / -888 |
| 68 | 04/10/2026 | `f06008f` | Simpler assets and accounting, side menu unchanged | 14 | +614 / -184 |
| 69 | 04/10/2026 | `56882a4` | Every division, district, upazila and union of Bangladesh; villages and mouzas from the form | 14 | +296 / -16 |
| 70 | 04/10/2026 | `0acd968` | Online payment status needs the payer's full mobile number | 3 | +10 / -2 |
| 71 | 04/10/2026 | `707964a` | App also runs under a sub-path (local XAMPP at /polsha) | 9 | +23 / -11 |
| 72 | 04/10/2026 | `224d073` | Public website at the main address, edited from Settings → Website | 13 | +1868 / -3 |
| 73 | 04/10/2026 | `1c5d9ac` | Water supply: connections, fixed monthly bills, collection with penalty | 35 | +3201 / -17 |
| 74 | 04/10/2026 | `832f7b8` | README: website, water supply, security fix and local XAMPP setup | 1 | +72 / -4 |
| 75 | 04/10/2026 | `a38f079` | README: water supply is live | 1 | +4 / -4 |
| 76 | 04/10/2026 | `5f8b78b` | Demo data covers water supply; purge keeps settings and real users | 3 | +253 / -3 |
| 77 | 04/10/2026 | `8ccb1cf` | Water bills everywhere: counter, field, online, reports, SMS, import | 51 | +1160 / -97 |
| 78 | 04/10/2026 | `95d25f7` | Demo covers the new water channels; settings tab, deploy disk, README | 4 | +92 / -8 |
| 79 | 05/10/2026 | `faefd7f` | Website: homepage redesigned to the approved sample | 20 | +2154 / -661 |
| 80 | 05/10/2026 | `f0c4c45` | Responsive fixes across the app and website | 10 | +146 / -109 |
| 81 | 05/10/2026 | `3faa34c` | Website: keep five numbers and two-column about down to tablet width | 2 | +21 / -5 |
| 82 | 05/10/2026 | `f083f68` | Water connections & customers redesigned to the approved sample | 6 | +924 / -101 |
| 83 | 06/10/2026 | `cfb03aa` | Water connection detail redesigned to the approved sample | 15 | +1681 / -165 |
| 84 | 06/10/2026 | `4e23706` | Water monthly bills page redesigned to the approved sample | 6 | +712 / -110 |
| 85 | 07/10/2026 | `6d80497` | Remaining water pages in the approved design | 11 | +1599 / -492 |
| 86 | 15/10/2026 | `efbb207` | Online license verification against the license server | 37 | +1304 / -380 |
| 87 | 15/10/2026 | `586738d` | Always serve the secure address | 2 | +7 / -0 |
| 88 | 15/10/2026 | `eb5856c` | License: a rate-limited server (429) counts as offline, never invalid | 5 | +29 / -6 |
| 89 | 29/10/2026 | `ef47dba` | Website: one page per menu item, contact form inbox | 28 | +2834 / -878 |
| 90 | 24/11/2026 | `947abbc` | Docs: database schema, plan, UI, chat and development history | 5 | +5450 / -0 |
| 91 | 24/11/2026 | `64e5783` | Irrigation rates by lift (1st, 2nd, 3rd lift) | 43 | লিফট মডিউল |
| 92 | 24/11/2026 | `5c43ac6` | Docs: lift rates in the development and chat history | 2 | ডকুমেন্ট |
| 93 | 24/11/2026 | `6f17e8b` | Lifts can be dropped; one lift rate for every land type | 14 | লিফট কমানো, জমির ধরন বাদ |
| 94 | 24/11/2026 | `212c6e8` | Docs: lift changes in the development and chat history | 2 | ডকুমেন্ট |
| 95 | 25/11/2026 | `3a39307` | Receipts & payments statements and the society at a glance | 20 | ফেজ ১৪ ধাপ ১ |
| 96 | 25/11/2026 | `7ce0975` | Receipts and the cash voucher in the society's paper layout | 32 | ফেজ ১৪ ধাপ ২ |
| 97 | 25/11/2026 | `4e38300` | Membership, loan, undertaking and withdrawal forms on the society's paper | 25 | ফেজ ১৪ ধাপ ৩ |

