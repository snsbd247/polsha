# UI — পল্লী সমবায় সমিতি + কৃষি সেচ ERP (Polsha)

> সফটওয়্যার (লগইন করা অংশ) ও সমিতির পাবলিক ওয়েবসাইটের পুরো UI নকশা: রং, টাইপোগ্রাফি, লেআউট, পাতার ধরন, মেন্যু, প্রিন্ট ও মোবাইল।
> সব পাতা সমিতির দেওয়া **অনুমোদিত নকশা-স্যাম্পল** অনুযায়ী তৈরি (README-এর "নতুন নকশায় আনা" অংশ)। কোড: `frontend/src`।

## সূচিপত্র

1. [ডিজাইন সিস্টেম](#১-ডিজাইন-সিস্টেম) — রং, ফন্ট, অঙ্ক ও তারিখ, আইকন
2. [App Layout](#২-app-layout) — Sidebar, Topbar, Content
3. [পাতার ধরন (Page Patterns)](#৩-পাতার-ধরন-page-patterns)
4. [ড্যাশবোর্ড](#৪-ড্যাশবোর্ড)
5. [মডিউলভিত্তিক মূল স্ক্রিন](#৫-মডিউলভিত্তিক-মূল-স্ক্রিন)
6. [রশিদ, রিপোর্ট ও প্রিন্ট](#৬-রশিদ-রিপোর্ট-ও-প্রিন্ট)
7. [লগইন ও পাবলিক পাতা](#৭-লগইন-ও-পাবলিক-পাতা)
8. [সমিতির ওয়েবসাইট](#৮-সমিতির-ওয়েবসাইট)
9. [রেস্পন্সিভ ও মোবাইল](#৯-রেস্পন্সিভ-ও-মোবাইল)
10. [দ্বিভাষিক (বাংলা/English)](#১০-দ্বিভাষিক-বাংলাenglish)
11. [পুনর্ব্যবহারযোগ্য কম্পোনেন্ট](#১১-পুনর্ব্যবহারযোগ্য-কম্পোনেন্ট)
12. [পুরো Sidebar মেন্যু](#১২-পুরো-sidebar-মেন্যু)

---

## ১. ডিজাইন সিস্টেম

**ভিত্তি:** Ant Design 6 (`ConfigProvider` theme token, `boot.tsx`)। নিজস্ব CSS: `index.css` (লেআউট, সাইডবার, টপবার, রশিদ), `pages/dashboard/dashboard.css`, `pages/site/landing.css`, `components/page-tabs.css`, `components/receipt.css`।

### রং

| ব্যবহার | রং | কোথায় ঠিক হয় |
|---|---|---|
| ব্র্যান্ড / Primary (বোতাম, লিংক, ট্যাব) | `#1f7a4d` (সবুজ) — ডিফল্ট | Settings → Branding & Logo → ব্র্যান্ড রং (`brand_color`); `lib/settings.ts` `DEFAULT_BRAND` |
| সাইডবারের পটভূমি | `#0f1f40` (গাঢ় নীল) | `AppLayout.tsx` `SIDEBAR_BG` |
| সাইডবারের নির্বাচিত আইটেম | `#1f6fe5` পটভূমি, সাদা লেখা | Menu theme token `darkItemSelectedBg` |
| সাইডবারের লেখা | `#e4eaf4` (hover-এ সাদা), উপশিরোনাম `#c7d1e2` | |
| পাতার পটভূমি | `#f4f6fa` | `index.css` body / `.ant-layout` |
| ইউজার Avatar | `#1f6fe5` | Topbar |
| মূল লেখা / গৌণ লেখা | `#111827` / `#1f2937` / `#374151` / `#4b5563` | dashboard.css, landing.css |
| বিপদ / বকেয়া / সতর্কতা | `#e53935`, `#dc2626`, হালকা `#fde4e4` | ড্যাশবোর্ডের সতর্কতা, বকেয়া |
| তথ্য / লিংক (ওয়েবসাইট) | `#1677d2`, `#2563eb`, হালকা `#e8f1fd` | ওয়েবসাইটের নীল সারি ও বোতাম |
| বর্ডার | `#d8dee8`, `#d1d5db`, `#eef1f6` | কার্ড, টেবিল |
| লোগোর প্রতীক (লোগো না থাকলে) | সবুজ পাতা `#1f9d55` / `#22b55f` + নীল পানির ঢেউ `#2563eb` | `AppLayout.tsx` SVG |

স্ট্যাটাস ট্যাগ সব জায়গায় একই অর্থে: সবুজ = সক্রিয়/পরিশোধিত/অনুমোদিত, কমলা = অপেক্ষমাণ/আংশিক, লাল = বকেয়া/প্রত্যাখ্যাত/বাতিল, ধূসর = নিষ্ক্রিয়/শেষ, নীল = খসড়া/তথ্য।

### টাইপোগ্রাফি

| ব্যবহার | ফন্ট |
|---|---|
| সফটওয়্যারের সব লেখা | `'Inter', 'Hind Siliguri', system-ui, sans-serif` — ইংরেজি অক্ষর ও অঙ্ক Inter-এ, বাংলা Hind Siliguri-তে |
| ওয়েবসাইটের শিরোনাম | `'Poppins', 'Hind Siliguri'` |
| ওজন | 400 / 500 / 600 / 700 (Google Fonts থেকে) |

সাইডবারে সমিতির নাম 17px/600 (সর্বোচ্চ ২ লাইন), উপনাম 12px।

### অঙ্ক, তারিখ ও টাকা

- বাংলা মোডে অঙ্ক বাংলায় (০–৯) — Settings অনুযায়ী; English মোডে ইংরেজি অঙ্ক।
- তারিখ `DD/MM/YYYY` (Settings-এ বদলানো যায়)।
- টাকা `৳ ১২,৫০০.০০` ধাঁচে; রশিদে "কথায় টাকা"।
- ইনপুটে বাংলা অঙ্ক দিলে নিজে থেকে ইংরেজিতে রূপান্তর।

### আইকন

`@ant-design/icons` + নিজস্ব SVG (`components/SideIcons.tsx` — সাইডবার গ্রুপের আইকন, `pages/dashboard/DashIcons.tsx` — KPI আইকন)।

---

## ২. App Layout

`components/AppLayout.tsx` — লগইন করা সব পাতার কাঠামো।

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [লোগো] সমিতির │  [☰]  [🔍 কৃষক/জমি খুঁজুন........]   [বাংলা|EN] [🔔3] [👤 নাম ▾] │  ← Topbar (.top-bar)
│ নাম / উপনাম  ├───────────────────────────────────────────────────────────┤
│──────────────│  হোম › কৃষক ও সদস্য › কৃষক তালিকা        [+ কৃষক যোগ] [⋯]   │  ← PageFrame
│ 🏠 ড্যাশবোর্ড │  ┌────────┐┌────────┐┌────────┐┌────────┐                   │
│ 👨‍🌾 কৃষক ও সদস্য│ │ কার্ড ১ ││ কার্ড ২ ││ কার্ড ৩ ││ কার্ড ৪ │  ← সারাংশ কার্ড     │
│   ├ কৃষক তালিকা│  └────────┘└────────┘└────────┘└────────┘                   │
│   ├ সদস্যপদ  (৩)│ [খোঁজা] [মৌজা ▾] [অবস্থা ▾] [তারিখ] [আরও ফিল্টার]          │  ← ফিল্টার
│   └ ...      │  ┌───────────────────────────────────────────────────────┐ │
│ 🌾 জমি        │  │ টেবিল (ছবি, নাম, ট্যাগ, টাকা, অ্যাকশন)                   │ │
│ 💧 সেচ        │  └───────────────────────────────────────────────────────┘ │
│ 🚰 পানি       │                              « ‹ ১ ২ ৩ › »  ২৫/পাতা        │
│ ...          │                                                           │
│ (255px)      │  Footer                                                   │
└──────────────┴───────────────────────────────────────────────────────────┘
```

**Sidebar** (`Sider`, চওড়া 255px, পটভূমি `#0f1f40`):
- উপরে ব্র্যান্ড: ৫০px গোল সাদা লোগো + সমিতির নাম ও উপনাম (`.side-brand`)।
- ১৬টি আইটেম: ড্যাশবোর্ড + ১৫টি গ্রুপ (নিচে [পুরো তালিকা](#১২-পুরো-sidebar-মেন্যু))।
- গ্রুপ খুললে ট্রি-লাইন সাবমেন্যু; ব্যাজ (যেমন সদস্যপদ আবেদনের অপেক্ষমাণ সংখ্যা — `.side-badge`)।
- অনুমতি না থাকলে আইটেম দেখায় না; একটাও আইটেম না থাকলে গ্রুপও লুকায়।
- একই পাতা একাধিক গ্রুপে থাকলে (যেমন QR Scanner, Ledger Integrity) দুই জায়গাতেই হাইলাইট।

**Topbar** (`Header.top-bar`):
- মোবাইলে ☰ বোতাম (Drawer মেন্যু খোলে)।
- `GlobalSearch` — কৃষক ও জমি খোঁজা (নাম, Farmer ID, NID, মোবাইল, দাগ, খতিয়ান); মোবাইলে টপবারের নিচে পুরো চওড়ায়।
- `LanguageToggle` — বাংলা/English।
- `AlertBell` — Bell সতর্কতা ও অপেক্ষমাণ অনুমোদন (`.bell-pop`)।
- ইউজার: ৪২px Avatar + নাম ও Role, ▾ মেনু (প্রোফাইল, পাসওয়ার্ড, লগআউট)।

**অন্যান্য:** লাইসেন্সের সতর্কতা Content-এর উপরে `Alert` হিসেবে; পাতা lazy-load হওয়ার সময় `Spin`; প্রিন্টে টপবার/সাইডবার লুকায় (`.no-print`)।

---

## ৩. পাতার ধরন (Page Patterns)

সব পাতা কয়েকটি একই ছাঁচে তৈরি, যাতে ব্যবহারকারী একবার শিখলে সব জায়গায় পারেন।

### ক. তালিকা পাতা (List Page) — সবচেয়ে বেশি ব্যবহৃত

1. **ব্রেডক্রাম্ব + অ্যাকশন বোতাম** (`PageFrame`) — পাতার আলাদা শিরোনাম নেই, ব্রেডক্রাম্বই পাতার নাম বলে (২৯/০৯/২০২৬-এর সিদ্ধান্ত)। ডানে প্রধান বোতাম (যেমন "+ কৃষক যোগ"), ইমপোর্ট, এক্সপোর্ট, "আরও ⋯"।
2. **সারাংশ কার্ড** — সাধারণত ৪টি (কোথাও ৫টি): আইকন, সংখ্যা, লেবেল, গত মাসের তুলনায় % (সবুজ ▲ / লাল ▼)।
3. **ফিল্টার সারি** — খোঁজা + ৩–৬টি ড্রপডাউন (মৌজা, উপজেলা, জেলা, অবস্থা, ধরন, তারিখের পরিসর); বেশি হলে "আরও ফিল্টার"।
4. **টেবিল** — ছবি (না থাকলে নামের আদ্যক্ষর), নাম + ID, রঙিন ট্যাগ, টাকা ডানে-সাজানো, শেষ কলামে 👁 / ✏️ / ⋯; কলাম দেখানো/লুকানো; সারি বাছাই (একসাথে প্রিন্ট/কার্ড)।
5. **Pagination** — ২৫/৫০/১০০ (ডিফল্ট Settings-এ), প্রথম/শেষ পাতার বোতাম।
6. **এক্সপোর্ট** — Excel/CSV, প্রিন্ট; বোতাম দেখায় শুধু `*.export` অনুমতিতে।

উদাহরণ: কৃষক তালিকা (৫টি কার্ড: মোট, সদস্য %, নন-মেম্বার %, অপেক্ষমাণ সদস্যপদ, মোট জমি একরে), জমির তালিকা, সদস্য তালিকা, রশিদ তালিকা, ঋণের তালিকা (ট্যাব: সব / অনুমোদনের অপেক্ষায় / বিতরণ বাকি / চলমান / পরিশোধিত)।

### খ. প্রোফাইল / বিস্তারিত পাতা

- উপরে হেডার কার্ড: ছবি, নাম, ID, পরিচিতি, QR, অবস্থা ট্যাগ, অ্যাকশন বোতাম।
- স্থিতি কার্ডের সারি (যেমন কৃষক: মোট জমি / সেচ বকেয়া / সঞ্চয় / ঋণ)।
- ট্যাব (`PageTabs`): কৃষক প্রোফাইলে ১১টি (ওভারভিউ, ব্যক্তিগত তথ্য, সদস্যপদ, জমি ও চাষ, সেচ, সঞ্চয়, ঋণ, শেয়ার, পেমেন্ট, ডকুমেন্ট, ইতিহাস); জমির প্রোফাইলে ৮টি (সাধারণ, মালিকানা, চাষ, বর্গা/লিজ, সেচ ইনভয়েস, ইতিহাস, ডকুমেন্ট, সংশ্লিষ্ট কৃষক)।
- ইতিহাস ট্যাবে Audit টাইমলাইন (আগের/পরের মান পাশাপাশি — লাল `.diff-old`, সবুজ `.diff-new`)।
- প্রিন্ট বোতাম।

### গ. ফর্ম পাতা

- অংশে ভাগ করা কার্ড (যেমন কৃষক ফর্ম: সদস্যপদের বিকল্প → ব্যক্তিগত তথ্য → ঠিকানা → ছবি ও ডকুমেন্ট → অতিরিক্ত তথ্য → পরিবারের সদস্য → খানা)।
- ধাপের ফর্ম যেখানে কাজটা লম্বা: সদস্যপদ আবেদন (৪ ধাপ, অগ্রগতি দেখায়), জমি হস্তান্তর, Import Wizard।
- ডানে সারাংশ/প্রিভিউ প্যানেল (ফি সারাংশ, কিস্তির হিসাব — প্রতি কিস্তি, মোট সুদ, মোট ফেরত)।
- ঠিকানা cascading (`LocationCascader`: বিভাগ → জেলা → উপজেলা → ইউনিয়ন → গ্রাম → মৌজা); ডিফল্ট এলাকা Settings থেকে আগে বসানো।
- ডকুমেন্ট টেনে এনে আপলোড; ছবি নিজে ছোট হয়।
- 422 error-এ সংশ্লিষ্ট ঘরের নিচে লাল বার্তা; Enter চাপলে অর্ধেক ফর্ম জমা হয় না।
- খসড়া রাখা ও সরাসরি জমা — দুই বোতাম, যেখানে অনুমোদন লাগে।

### ঘ. আদায় (Collect) পাতা

এক স্ক্রিনে: সদস্য/কৃষক/গ্রাহক খোঁজা → বকেয়া বিল/কিস্তি টিক দিয়ে বাছাই → "আজ দিতে হবে" মোট → টাকা ও পদ্ধতি (নগদ/ব্যাংক/বিকাশ/নগদ) → আদায় → সাথে সাথে রশিদ প্রিন্টের Modal।

### ঙ. অনুমোদন

- Approval Inbox — ট্যাব: আমার কাছে / আমার পাঠানো / সব; সাইডবার ও Bell-এ সংখ্যা।
- বিস্তারিত: পরিবর্তনের তালিকা, ডকুমেন্ট, ধাপের টাইমলাইন, মন্তব্য, সিদ্ধান্তের বোতাম (অনুমোদন / ফেরত / প্রত্যাখ্যান — শেষ দুটোয় কারণ বাধ্যতামূলক)।
- নিজের অনুরোধে বোতামের জায়গায় লেখা থাকে কে অনুমোদন দেবেন।

### চ. রিপোর্ট পাতা

`ReportHub` (রিপোর্ট কেন্দ্র — বিভাগভিত্তিক কার্ডের তালিকা) → `ReportView` (ফিল্টার, টেবিল, মোট সারি, প্রিন্ট ও Excel)।

### ছ. খালি অবস্থা ও লোডিং

খালি তালিকায় Ant Design `Empty` + পরের কাজের বোতাম; লোডিং-এ Skeleton/Spin; ভবিষ্যতের মেন্যুর জন্য "শীঘ্রই আসছে" পাতা (`ComingSoonPage`, `lib/comingSoon.ts`)।

---

## ৪. ড্যাশবোর্ড

`pages/DashboardPage.tsx` + `pages/dashboard/dashboard.css` — অনুমোদিত নকশা অনুযায়ী।

```
ড্যাশবোর্ড                                   [আজ: ২৪/১১/২০২৬] [⟳ হালনাগাদ]
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│মোট   │সদস্য │অ-সদস্য│মোট   │সেচ   │সেচ   │সেচের │পানির │   ← KPI কার্ড (আইকন, মান,
│কৃষক  │কৃষক  │কৃষক  │জমি   │ইনভয়েস│আদায় │বকেয়া │বিল   │     গত মাস/মৌসুমের তুলনায় %)
├──────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│পানির │মোট   │ঋণ    │হাতে  │ব্যাংক │মোট   │      │      │
│বকেয়া │ঋণ    │বকেয়া │নগদ   │জমা   │সম্পদ │      │      │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘
┌─────────────────────────────────────┐┌──────────────────────┐
│ দৈনিক আদায় — গত ৪০ দিন (বার চার্ট)    ││ আদায় বনাম বকেয়া      │
│ সেচ · পানি · ঋণ · সঞ্চয় রঙে আলাদা      ││ (এই মৌসুম, ডোনাট)     │
└─────────────────────────────────────┘└──────────────────────┘
┌──────────────────┐┌──────────────────┐┌──────────────────────┐
│ সাম্প্রতিক লেনদেন  ││ অপেক্ষমাণ অনুমোদন  ││ গুরুত্বপূর্ণ সতর্কতা  │
│ তারিখ·নাম·ধরন·টাকা││ আবেদনকারী·অবস্থা  ││ (লাল সংখ্যা, লিংক)    │
└──────────────────┘└──────────────────┘└──────────────────────┘
```

- **KPI:** মোট কৃষক, সদস্য কৃষক, অ-সদস্য কৃষক, মোট জমি (একর), সেচ ইনভয়েস, সেচ আদায়, সেচের বকেয়া, পানির বিল আদায় (এই মাস), পানির বিল বকেয়া, মোট ঋণ, ঋণ বকেয়া, হাতে নগদ (খাতভিত্তিক), ব্যাংক জমা, মোট সম্পদ।
- **সতর্কতা:** ৩০ দিনের বেশি সেচ বকেয়া, ঋণ কিস্তি, সদস্য আবেদন, সঞ্চয় উত্তোলন, ব্যাংক মিলকরণ, সম্পদ রক্ষণাবেক্ষণ, পানির বকেয়া — "সব দেখুন / কম দেখুন"।
- চার্ট নিজস্ব CSS-এ আঁকা (কোনো চার্ট লাইব্রেরি নেই — হালকা রাখার জন্য)।
- অনুমতি অনুযায়ী কার্ড লুকায়।

---

## ৫. মডিউলভিত্তিক মূল স্ক্রিন

| মডিউল | মূল স্ক্রিন ও নকশার বিশেষত্ব |
|---|---|
| কৃষক ও সদস্য | কৃষক তালিকা (৫ কার্ড, QR সদস্য কার্ড একসাথে প্রিন্ট), কৃষক প্রোফাইল (১১ ট্যাব), কৃষক ফর্ম, সদস্যপদ আবেদন (৪ ধাপ) ও তালিকা (৫ কার্ড), সদস্য তালিকা (৪ কার্ড), ভোটার তালিকা (স্বাক্ষরসহ প্রিন্ট), কৃষক মার্জ (দুই কলামে মিলিয়ে প্রতিটি ঘর বাছাই), মুছে ফেলা কৃষক, পাতওয়ারী, মৌজা |
| জমি | জমির তালিকা (দুই সারির ফিল্টার, রঙিন জমির ধরন, নিজে চাষ করলে "নিজে"), জমি ফর্ম (GPS বোতাম, একক/যৌথ মালিক `OwnersEditor`), জমির প্রোফাইল (প্রতীকী নকশা, মালিক ও চাষির কার্ড, ৮ ট্যাব, গুগল ম্যাপ লিংক), মালিক ও চাষি, বর্গা/লিজ, জমি হস্তান্তর (ধাপের ফর্ম) ও তালিকা, জমির ইতিহাস, জমির ধরন, জমির রিপোর্ট |
| সেচ | মৌসুম (তালিকা, ফর্ম, বিস্তারিত), ইনভয়েস (একক ও Bulk, Billing Split Preview), সেচ চার্জ আদায়, রেট (এক পাতায়, আগের মৌসুমের রেট কপি), পুরোনো রশিদ, Due Mismatch, Lookup |
| পানি সরবরাহ | সংযোগ ও গ্রাহক (৫টি রঙিন সারাংশ কার্ড), সংযোগের বিস্তারিত, মাসিক বিল তৈরি (মাস বাছাই → প্রিভিউ → তৈরি), পানির বিল, বিল আদায়, পানির রশিদ, বকেয়া, সংযোগের ধরন ও ফি, নগদ বিবরণী |
| সঞ্চয় | ৬টি সমতল পাতা: সঞ্চয় হিসাবের তালিকা, শেয়ার আদায়ের তালিকা, উত্তোলনের তালিকা, উত্তোলন অনুমোদন, হিসাব বন্ধ, হিসাবের ইতিহাস; লেনদেন Modal (`FundTxnModal`) ও স্লিপ (`FundReceipt`) |
| ঋণ | ঋণের তালিকা (৫ ট্যাব), নতুন ঋণ (সাথে সাথে কিস্তির হিসাব), কিস্তি আদায় (এক স্ক্রিন), বকেয়া ঋণ, জামিনদার, ঋণের প্ল্যান (৬টি মূল ঘর + "উন্নত সেটিংস"); এক ঋণের সব তথ্য এক পাতায় ট্যাবে |
| নগদ ও পেমেন্ট | টাকা আদায় (এক স্ক্রিন), রশিদের তালিকা, একত্রিত পেমেন্ট, মাঠে আদায় (মোবাইলের জন্য বড় বোতাম ও এক কলাম), QR স্ক্যানার (ক্যামেরা Modal), ক্যাশ বই, হাতে নগদ, দিন বন্ধ (নোট গণনার টেবিল), অনুমোদন |
| ক্যাশ বই ও খতিয়ান | সেচ ও সমিতির নগদ বিবরণী — অডিট শিটের মতো টেবিল; আয়-ব্যয় নগদ বই — কাগজের খাতার মতো দুই পাশে আয়/ব্যয় |
| সম্পদ | সম্পদ ড্যাশবোর্ড, রেজিস্টার, Stock / Installation / Repair / Sales ভিউ, স্থানান্তর, মেরামতের সময়সূচি, বিস্তারিত, ফর্ম, রিপোর্ট |
| হিসাব | ভাউচার তালিকা, জার্নাল ফর্ম (ডেবিট = ক্রেডিট না মিললে লাল), Chart of Accounts (গাছ), ব্যাংক, মিলকরণ, Trial Balance, Balance Sheet ইত্যাদি — ১৪টি পাতা |
| রিপোর্ট / অডিট | রিপোর্ট কেন্দ্র, Collection/Due/Audit রিপোর্ট, System Audit Log (আগের/পরের মান), Data Integrity Scan (`IntegrityResults`), Day Reconciliation |
| প্রশাসন | ইউজার, Role, Permission Matrix (সারি/কলাম একসাথে টিক), পাতওয়ারী, মৌজা Data Health, Ledger Integrity, রশিদ সিরিয়াল |
| টুলস ও ইমপোর্ট | প্রতিটি ইমপোর্ট একই `ImportWizard` কাঠামোয় (আপলোড → কলাম মেলানো → যাচাই → Preview → নিশ্চিত); Import Audit |
| সেটিংস | সব সেটিংস পাতায় একই শিরোনাম ও ট্যাবের সারি (সাধারণ, ব্র্যান্ডিং ও লোগো, রশিদ, অর্থবছর, SMS, সিস্টেম পছন্দসমূহ, লাইসেন্স, ওয়েবসাইট …) — ট্যাব পাশে স্ক্রল করে, খোলা ট্যাব নিজে দৃশ্যমান হয় |

---

## ৬. রশিদ, রিপোর্ট ও প্রিন্ট

**রশিদ** (`components/receipt.css`, `PrintParts.tsx`) — সমিতির কাগজের স্লিপের মতো:

```
┌──────────────────────────────────────────────┐
│ [লোগো]  সমিতির নাম (বড়)               [QR] │  ← .receipt-letterhead
│         ঠিকানা · ফোন · নিবন্ধন নং            │
│──────────────── টাকা প্রাপ্তির রশিদ ──────────│  ← .receipt-title
│ রশিদ নং: ....   তারিখ: ..../..../....         │
│ নাম: ....  পিতা: ....  সদস্য নং / Farmer ID   │
│ (বর্গা হলে) মালিক: ....                       │
│ ┌─────────────────────────────┬────────────┐ │
│ │ বিবরণ (মৌসুম, দাগ, পরিমাণ)    │ টাকা       │ │
│ └─────────────────────────────┴────────────┘ │
│ মোট: ৳ ....   কথায়: .................. টাকা   │
│ আদায়ের পরে বকেয়া: ৳ ....                       │
│ [সিল]                    গ্রহীতার স্বাক্ষর      │  ← .receipt-seal / signature
│ ফুটার লেখা                                    │
└──────────────────────────────────────────────┘
   বাতিল হলে উপরে "বাতিলকৃত" ছাপ (.receipt-stamp)
```

- কাগজ A4 / A5 / থার্মাল; এক পাতায় ১ বা ২ কপি (অফিস কপি + গ্রাহক কপি) — Settings → রশিদ।
- QR স্ক্যান করলে লগইন ছাড়া `/verify/...` পাতায় রশিদের সত্যতা।
- পুনর্মুদ্রণ রেকর্ড হয়।

**রিপোর্ট প্রিন্ট:** লেটারহেড (লোগো, নাম, ঠিকানা) + ফিল্টারের সারাংশ + টেবিল + মোট + স্বাক্ষরের জায়গা; ব্রাউজারের Print → PDF (বাংলা ফন্ট ঠিক থাকে)। `@media print` সাইডবার, টপবার, বোতাম লুকায় (`.no-print`, `.print-only`)।

**সদস্য কার্ড:** সমিতির নাম, ছবি, নাম, সদস্য নং, QR, কার্ডের নোট; অনেকজনের কার্ড একসাথে প্রিন্ট।

---

## ৭. লগইন ও পাবলিক পাতা

| পাতা | Route | নকশা |
|---|---|---|
| লগইন | `/login` | মাঝখানে কার্ড: লোগো, সমিতির নাম, ইউজারনেম/মোবাইল, পাসওয়ার্ড, "পাসওয়ার্ড ভুলে গেছেন?", ভাষা toggle |
| পাসওয়ার্ড রিসেট | `/forgot-password` | মোবাইল → SMS কোড → নতুন পাসওয়ার্ড |
| প্রথম লগইনে পাসওয়ার্ড বদল | `/change-password` | বাধ্যতামূলক, অন্য কোথাও যাওয়া যায় না |
| প্রোফাইল | `/profile` | তথ্য, ছবি, পাসওয়ার্ড, সব ডিভাইস থেকে লগআউট |
| অনলাইন পেমেন্ট | `/pay` | লগইন ছাড়া: Farmer ID / WC- নম্বর → বকেয়া দেখা → বিকাশ/নগদের লেনদেন নম্বর জমা → অবস্থা দেখা (পুরো মোবাইল নম্বর দিয়ে) |
| রশিদ যাচাই | `/verify/:kind/:token` | রশিদের সারাংশ ও "সঠিক রশিদ" / "বাতিলকৃত" চিহ্ন |

---

## ৮. সমিতির ওয়েবসাইট

`pages/site/*` + `landing.css` (সব class `ld-` দিয়ে শুরু)। সফটওয়্যারের রং ও ধাঁচে; সমিতির দেওয়া নমুনা ছবি হুবহু অনুসরণ করে (০৫/১০/২০২৬)। সর্বোচ্চ চওড়া 1320px।

**পাতা:** হোম `/` · পরিচিতি `/about` · সেবা `/services` ও `/services/:key` · নোটিশ `/notices` ও `/notices/:id` · গ্যালারি `/gallery` · প্রশ্নোত্তর `/faq` · যোগাযোগ `/contact` · পুরোনো এক-পাতার সংস্করণ `/site`। লগইন করা ইউজার `/` খুললে ড্যাশবোর্ডে যান।

```
┌──────────────────────────────────────────────────────────────────┐
│ 📍 ঠিকানা   📞 ফোন   ✉ ইমেইল                    [f] [▶] [in]     │  ← নীল উপরের সারি
├──────────────────────────────────────────────────────────────────┤
│ [লোগো] নাম / উপনাম / স্লোগান   হোম পরিচিতি সেবা নোটিশ গ্যালারি  │  ← .ld-head (sticky)
│                                FAQ যোগাযোগ  [বাংলা|EN] [লগইন]    │
├──────────────────────────────────────────────────────────────────┤
│  ব্যানার ছবি + ছায়া (.ld-hero)                                    │
│  ছোট উপরের লাইন (kicker) / বড় শিরোনাম / বর্ণনা                    │
│  [অনলাইন পেমেন্ট]  [আমাদের সেবা]       ┌─নীল কার্ড─┐┌─সবুজ কার্ড─┐│
│                                        └──────────┘└───────────┘│
├──────────────────────────────────────────────────────────────────┤
│  দ্রুত সংখ্যা (.ld-quick): সক্রিয় সদস্য · কৃষক · সেচকৃত জমি (একর) │
│  · পানির সংযোগ · প্রতিষ্ঠার সাল  — আসল হিসাব থেকে                │
├──────────────────────────────────────────────────────────────────┤
│  পরিচিতি (.ld-about): ছবি | লেখা, লক্ষ্য-উদ্দেশ্য                │
│  সেবা (.ld-services): কার্ডের গ্রিড → সেবার বিস্তারিত              │
│  নোটিশ ও খবর (.ld-nf): তারিখসহ নোটিশ, PDF সংযুক্তি               │
│  সভাপতির বাণী, কমিটি (ছবি ও পদবি)                                 │
│  CTA (.ld-cta): পটভূমির ছবি + "অনলাইনে বিল দিন" বোতাম             │
├──────────────────────────────────────────────────────────────────┤
│  ফুটার (.ld-foot): লোগো ও পরিচিতি · দ্রুত লিংক · যোগাযোগ ·         │
│  সোশ্যাল · নিচে কপিরাইট সারি (.ld-foot-bar)                       │
└──────────────────────────────────────────────────────────────────┘
```

- বোতাম: `.ld-btn-green` (প্রধান), `.ld-btn-outline`, `.ld-btn-white`।
- ভেতরের পাতায় ব্যানার + ব্রেডক্রাম্ব (`.ld-banner`, `.ld-crumbs`)।
- যোগাযোগ: যোগাযোগের কার্ড, ফর্ম (দুই কলাম `.ld-form-2`), গুগল ম্যাপ (শুধু google.com/maps embed গ্রহণ করে)।
- FAQ: খোঁজার ঘর + accordion।
- মোবাইলে মেন্যু `.ld-burger` → `.ld-drawer`।
- সব লেখা/ছবি Settings → ওয়েবসাইট থেকে; খালি অংশ নিজে লুকায়, নমুনা নাম লাইভে যায় না।

---

## ৯. রেস্পন্সিভ ও মোবাইল

- সফটওয়্যারের ১৪৩টি পাতা ও ওয়েবসাইট ৩৬০ / ৭৬৮ / ১১০০px চওড়ায় যাচাই করা (০৫/১০/২০২৬)।
- Breakpoint: সফটওয়্যার — Ant Design `Grid.useBreakpoint` (md-এর নিচে মোবাইল); ওয়েবসাইট — 1360, 1180, 960, 860, 767, 640px।
- মোবাইলে: সাইডবার → বাম দিকের Drawer (275px); খোঁজা টপবারের নিচে; সারাংশ কার্ড ২ কলাম বা ১ কলাম; টেবিল পাশে স্ক্রল; ফিল্টার একটার নিচে আরেকটা; সেটিংসের ট্যাব পাশে স্ক্রল।
- ওয়েবসাইটে ট্যাবলেট পর্যন্ত পাঁচটি সংখ্যা ও দুই কলামের পরিচিতি থাকে।
- মাঠে আদায় ও QR স্ক্যানার মোবাইলের জন্যই তৈরি (ক্যামেরা, বড় বোতাম)।

---

## ১০. দ্বিভাষিক (বাংলা/English)

- Topbar ও লগইন পাতায় toggle; পছন্দ ইউজারের প্রোফাইলে (`users.locale`) থাকে।
- Frontend: সব লেখা `tx('বাংলা')`, ইংরেজি `src/locales/en.json`-এ; English অভিধান শুধু English মোডে লোড হয়।
- মেন্যু: ইংরেজি মোডে হুবহু সমিতির দেওয়া ইংরেজি নাম।
- antd ও dayjs locale ভাষা অনুযায়ী; English-এ ইংরেজি অঙ্ক ও তারিখ।
- ইংরেজি নাম (কৃষক, ইউজার, সমিতি) থাকলে English মোডে সেটাই আগে দেখায়; বাকি ডেটা যেমন আছে তেমন।
- যাচাই: `npm run i18n:check`, `npm run i18n:wrap`।

---

## ১১. পুনর্ব্যবহারযোগ্য কম্পোনেন্ট

| কম্পোনেন্ট | কাজ |
|---|---|
| `AppLayout` | সাইডবার, টপবার, Drawer, মেন্যু, লাইসেন্স সতর্কতা |
| `PageFrame` | ব্রেডক্রাম্ব, (ঐচ্ছিক) শিরোনাম/উপশিরোনাম, অ্যাকশন বোতাম |
| `PageTabs`, `SubTabs` | পাতার ট্যাব ও উপ-ট্যাব |
| `GlobalSearch` | কৃষক/জমি খোঁজা |
| `AlertBell` | সতর্কতা ও অনুমোদনের Bell |
| `LanguageToggle` | ভাষা বদল |
| `FarmerPicker`, `FundMemberPicker`, `LoanMemberPicker` | খুঁজে বাছাই (ছবি, ID, মোবাইলসহ) |
| `LocationCascader` | এলাকার cascading বাছাই |
| `OwnersEditor` | জমির একাধিক মালিক ও অংশ % (মোট ১০০% যাচাই) |
| `FarmerLandsTab` | কৃষকের জমির ট্যাব |
| `DuplicateMatches` | ডুপ্লিকেট কৃষকের সতর্কতার তালিকা |
| `FundTxnModal`, `FundReceipt` | সঞ্চয়/শেয়ার লেনদেন ও স্লিপ |
| `PrintParts`, `QrLabel` | প্রিন্টের লেটারহেড, স্বাক্ষর, QR |
| `QrScanModal` | ক্যামেরা দিয়ে QR স্ক্যান |
| `ImportWizard` | ধাপে ধাপে Import |
| `ReportHub`, `ReportView` | রিপোর্ট কেন্দ্র ও রিপোর্ট |
| `IntegrityResults` | Integrity Scan-এর ফল |
| `AuditLogTable` | Audit Log (আগের/পরের মান) |
| `ProtectedImage` | লগইন-সুরক্ষিত ছবি (token দিয়ে) |
| `RelatedLinks` | সংশ্লিষ্ট পাতার লিংক (মেন্যুতে নেই এমন পাতার জন্য) |
| `PasswordForm`, `ResetPasswordModal` | পাসওয়ার্ড |

---

## ১২. পুরো Sidebar মেন্যু

`components/AppLayout.tsx`-এর `GROUPS` থেকে হুবহু। প্রথমে **🏠 ড্যাশবোর্ড / Dashboard** (`/`), তারপর ১৫টি গ্রুপ। "অনুমতি" কলামে যে অনুমতি থাকলে আইটেমটি দেখায় (খালি = সংশ্লিষ্ট গ্রুপের সবার জন্য, বা পাতার ভেতরে যাচাই)।

### 1. কৃষক ও সদস্য / Farmers & Members

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | কৃষক তালিকা | Farmer List | `/farmers` | `farmer.view` |
| 2 | সদস্যপদ আবেদন | Membership Applications | `/membership/applications` | `membership.view` |
| 3 | সদস্য তালিকা | Member List | `/members` | `member.view` |
| 4 | ভোটার তালিকা | Voter List | `/members/voters` | `member.view` |
| 5 | ভোটার ইতিহাস | Voter History | `/members/voter-history` | `member.view` |
| 6 | ভোটার অডিট | Voter Audit | `/members/voter-audit` | `member.view` |
| 7 | ভর্তি রেজিস্টার | Admission Register | `/members/admission-register` | `member.view` |
| 8 | কৃষক একীকরণ | Farmer Merge | `/farmers/merge` | `farmer.edit` |
| 9 | মুছে ফেলা কৃষক | Deleted Farmers | `/farmers/deleted` | `farmer.view` |
| 10 | পাটোয়ারী তালিকা | Patwari List | `/masters/patwaris` | `patwari.view` |
| 11 | মৌজা ব্যবস্থাপনা | Mouza Management | `/masters/mouzas` |  |

### 2. জমি ব্যবস্থাপনা / Land Management

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | জমির তালিকা | Land List | `/lands` | `land.view` |
| 2 | নতুন জমি | Add Land | `/lands/new` | `land.create` |
| 3 | জমির প্রোফাইল | Land Profile | `/lands/lookup` | `land.view` |
| 4 | মালিক ও চাষি | Owner & Cultivator | `/lands/owners` | `land.view` |
| 5 | বর্গা চাষ | Borga / Sharecropping | `/lands/borga` | `land.view` |
| 6 | জমি হস্তান্তর | Land Transfer | `/lands/transfers/new` | `land.edit` |
| 7 | জমি হস্তান্তরের তালিকা | Land Transfer List | `/lands/transfers` | `land.view` |
| 8 | জমির ইতিহাস | Land History | `/lands/lookup/history` | `land.view` |
| 9 | জমির ধরন | Land Types | `/settings/land-types` | `settings.admin` |
| 10 | জমির রিপোর্ট | Land Reports | `/lands/reports` | `land.view` |

### 3. সেচ / Irrigation

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | মৌসুম | Seasons | `/irrigation/seasons` | `irrigation.view` |
| 2 | সেচের রেট | Irrigation Rates | `/irrigation/rates` | `irrigation.view` |
| 3 | বিল তৈরি | Create Bills | `/irrigation/invoices/bulk` | `irrigation.create` |
| 4 | সেচ ইনভয়েস | Irrigation Invoices | `/irrigation/invoices` | `irrigation.view` |
| 5 | সেচ বকেয়া | Irrigation Dues | `/irrigation/dues` | `irrigation.view` |
| 6 | পুরোনো রশিদ এন্ট্রি | Old Receipt Entry | `/payments/collect?legacy=1` | `payment.create` |

### 4. পানি সরবরাহ / Water Supply

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | সংযোগ ও গ্রাহক | Connections & Customers | `/water/connections` | `water.view` |
| 2 | মাসিক বিল তৈরি | Create Monthly Bills | `/water/billing` | `water.create` |
| 3 | পানির বিল | Water Bills | `/water/bills` | `water.view` |
| 4 | বিল আদায় | Collect Bills | `/water/collect` | `water.create` |
| 5 | পানির রশিদ | Water Receipts | `/water/receipts` | `water.view` |
| 6 | বকেয়া তালিকা | Dues | `/water/dues` | `water.view` |
| 7 | পানির নগদ বিবরণী | Water Cash Statement | `/water/statement` | `water.view` |
| 8 | সংযোগের ধরন ও মাসিক ফি | Connection Types & Fees | `/water/types` | `water.view` |

### 5. সঞ্চয় / Savings

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | সঞ্চয় হিসাবের তালিকা | Savings Account List | `/savings/accounts` | `savings.view`, `share.view` |
| 2 | শেয়ার আদায়ের তালিকা | Share Collection List | `/savings/shares` | `share.view` |
| 3 | উত্তোলনের তালিকা | Withdrawal List | `/savings/withdrawals` | `savings.view` |
| 4 | উত্তোলন অনুমোদন | Withdrawal Approval | `/savings/withdrawals/approval` | `savings.view` |
| 5 | হিসাব বন্ধ | Close Account | `/savings/accounts/close` | `savings.view`, `share.view` |
| 6 | হিসাবের ইতিহাস | Account History | `/savings/accounts/history` | `savings.view`, `share.view` |

### 6. ঋণ / Loans

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | ঋণের তালিকা | Loan List | `/loans` | `loan.view` |
| 2 | নতুন ঋণ | New Loan | `/loans/new` | `loan.create` |
| 3 | কিস্তি আদায় | Collect Instalment | `/loans/payments` | `loan.view` |
| 4 | বকেয়া ঋণ | Overdue Loans | `/loans/dues` | `loan.view` |
| 5 | জামিনদার | Guarantors | `/loans/guarantors` | `loan.view` |
| 6 | ঋণের প্ল্যান | Loan Plans | `/loans/products` | `loan.view` |

### 7. নগদ ও পেমেন্ট / Cash & Payments

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | টাকা আদায় | Collect Money | `/payments/collect` | `payment.create` |
| 2 | রশিদ | Receipts | `/payments/receipts` | `payment.view` |
| 3 | মাঠে আদায় (মোবাইল) | Field Collection (Mobile) | `/payments/field` | `field.create`, `field.view`, `field.approve` |
| 4 | দিন বন্ধ | Day Close | `/cash/day-close` | `cash.view` |
| 5 | হাতে নগদ | Hand Cash | `/accounting/funds` | `cash.view`, `bank.view` |
| 6 | QR স্ক্যানার | QR Scanner | `/qr/scan` |  |
| 7 | QR স্ক্যান ইতিহাস | QR Scan History | `/qr/history` |  |
| 8 | অনুমোদন | Approvals | `/approvals` |  |

### 8. ক্যাশ বই ও খতিয়ান / Cash Book & Ledger

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | সেচ নগদ বিবরণী | Irrigation Cash Statement | `/cashbook/irrigation` | `accounting.view`, `cash.view`, `bank.view` |
| 2 | সমিতির নগদ বিবরণী | Society Cash Statement | `/cashbook/society` | `accounting.view`, `cash.view`, `bank.view` |
| 3 | আয়-ব্যয় নগদ বই | Income & Expense Cash Book | `/cashbook/income-expense` | `accounting.view`, `cash.view`, `bank.view` |
| 4 | ক্যাশ বই (খতিয়ান) | Cash Book (Ledger) | `/accounting/ledger` | `accounting.view`, `cash.view`, `bank.view` |
| 5 | Export অডিট | Export Audit | `/audit/exports` | `audit.view` |

### 9. সম্পদ / Assets

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | সম্পদ ড্যাশবোর্ড | Asset Dashboard | `/assets/dashboard` | `asset.view` |
| 2 | সম্পদ রেজিস্টার | Asset Registry | `/assets` | `asset.view` |
| 3 | স্টক | Stock | `/assets/stock` | `asset.view }` |
| 4 | সম্পদ স্থানান্তর | Asset Transfer | `/assets/transfers` | `asset.view` |
| 5 | স্থাপন | Installation | `/assets/installations` | `asset.view` |
| 6 | মেরামত | Repair | `/assets/repairs` | `asset.view` |
| 7 | মেরামত সূচি | Repair Schedule | `/assets/maintenances` | `asset.view` |
| 8 | বিক্রয় | Sales | `/assets/sales` | `asset.view` |
| 9 | QR স্ক্যানার | QR Scanner | `/qr/scan` |  |
| 10 | QR ইতিহাস | QR History | `/qr/history` |  |
| 11 | সম্পদের রিপোর্ট | Asset Reports | `/assets/reports` | `asset.view` |

### 10. হিসাব / Accounting

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | আর্থিক সারসংক্ষেপ | Financial Summary | `/accounting/summary` | `accounting.view` |
| 2 | হিসাবের তালিকা | Chart of Accounts | `/accounting/accounts` | `accounting.view` |
| 3 | জার্নাল এন্ট্রি | Journal Entries | `/accounting/journals/new` | `accounting.create` |
| 4 | হিসাবকাল বন্ধ | Period Close | `/accounting/periods` | `accounting.view` |
| 5 | প্রারম্ভিক নগদ জের | Opening Cash Balance | `/accounting/journals/new?type=opening` | `accounting.create` |
| 6 | উৎস বনাম খতিয়ান | Source vs Ledger | `/accounting/source-vs-ledger` | `accounting.view` |
| 7 | সেচের নগদ ও ব্যাংক | Irrigation Cash & Bank | `/accounting/irrigation-cash-bank` | `accounting.view`, `cash.view`, `bank.view` |
| 8 | মাসিক ব্যাংক মিলকরণ | Monthly Reconciliation | `/accounting/bank-reconciliations` | `bank.view` |
| 9 | শেয়ার মূলধন মিলকরণ | Share Capital Reconciliation | `/funds/share/audit` | `share.view` |
| 10 | লেজার সঠিকতা | Ledger Integrity | `/accounting/ledger-integrity` | `accounting.view` |
| 11 | ব্যাংক হিসাব | Bank Accounts | `/accounting/bank-accounts` | `bank.view` |
| 12 | ভাউচার | Vouchers | `/accounting/journals` | `accounting.view` |
| 13 | অনলাইন পেমেন্ট অনুরোধ | Public Payment Requests | `/accounting/public-payments` | `payment.view` |
| 14 | পেমেন্ট মিলকরণ | Payment Reconciliation | `/accounting/payment-reconciliation` | `payment.view` |

### 11. রিপোর্ট / Reports

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | আদায়ের রিপোর্ট | Collection Reports | `/reports/collections` | `payment.view` |
| 2 | বকেয়ার রিপোর্ট | Due Reports | `/reports/dues` | `irrigation.view`, `loan.view` |
| 3 | অডিট রিপোর্ট | Audit Reports | `/reports/audit` | `audit.view` |

### 12. অডিট ও পর্যবেক্ষণ / Audit & Monitoring

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | সিস্টেম অডিট লগ | System Audit Log | `/audit/logs` | `audit.view` |
| 2 | ডেটা সঠিকতা স্ক্যান | Data Integrity Scan | `/audit/integrity-scan` | `audit.view` |
| 3 | দৈনিক মিলকরণ | Day Reconciliation | `/cash/day-close` | `cash.view` |
| 4 | সেচ বকেয়া অমিল | Irrigation Due Mismatch | `/irrigation/mismatch` | `irrigation.view` |
| 5 | মৌসুম / জমির ধরন অনুসন্ধান | Season / Land-Type Lookup | `/irrigation/lookup` | `irrigation.view` |

### 13. প্রশাসন / Admin

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | ইউজার | Users | `/admin/users` | `user.view }` |
| 2 | রোল | Roles | `/admin/roles` | `role.view }` |
| 3 | অনুমতি | Permissions | `/admin/permissions` | `role.view` |
| 4 | পাটোয়ারী ব্যবস্থাপনা | Patwari Management | `/masters/patwaris` | `patwari.view` |
| 5 | মৌজা ডেটা হেলথ | Mouza Data Health | `/data-health` | `land.view` |
| 6 | লেজার সঠিকতা | Ledger Integrity | `/accounting/ledger-integrity` | `accounting.view` |
| 7 | রশিদ সিরিয়াল প্রশাসন | Receipt Serial Admin | `/admin/receipt-serials` | `settings.admin` |

### 14. টুলস ও ইমপোর্ট / Tools & Import

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | কৃষক ইমপোর্ট | Farmer Import | `/imports?type=farmers` | `import.create` |
| 2 | জমি ইমপোর্ট | Land Import | `/imports?type=lands` | `import.create` |
| 3 | সঞ্চয়ের প্রারম্ভিক ইমপোর্ট | Savings Opening Import | `/imports/savings-opening` | `import.create` |
| 4 | শেয়ারের প্রারম্ভিক ইমপোর্ট | Share Opening Import | `/imports/share-opening` | `import.create` |
| 5 | ঋণের প্রারম্ভিক ইমপোর্ট | Loan Opening Import | `/imports/loan-opening` | `import.create` |
| 6 | পেমেন্ট ইমপোর্ট | Payment Import | `/imports/payments` | `import.create` |
| 7 | পুরোনো সেচ ডেটা ইমপোর্ট | Legacy Irrigation Import | `/imports/legacy-irrigation` | `import.create` |
| 8 | পানির সংযোগ ইমপোর্ট | Water Connections Import | `/imports/water-connections` | `import.create` |
| 9 | ইমপোর্ট অডিট | Import Audit | `/imports/audit` | `import.create` |

### 15. সেটিংস / Settings

| # | মেন্যু (বাংলা) | Menu (English) | Route | অনুমতি |
|---|---|---|---|---|
| 1 | সাধারণ সেটিংস | General Settings | `/settings/general` | `settings.admin` |
| 2 | ব্র্যান্ডিং ও লোগো | Branding & Logo | `/settings/branding` | `settings.admin` |
| 3 | রশিদ সেটিংস | Receipt Settings | `/settings/receipt` | `settings.admin` |
| 4 | SMS সেটিংস | SMS Settings | `/settings/sms` | `settings.admin` |
| 5 | SMS টেমপ্লেট | SMS Templates | `/settings/sms-templates` | `settings.admin` |
| 6 | SMS লগ | SMS Logs | `/settings/sms-logs` | `settings.admin` |
| 7 | অর্থবছর | Financial Year | `/settings/financial-year` | `settings.admin` |
| 8 | সিস্টেম পছন্দসমূহ | System Preferences | `/settings/preferences` | `settings.admin` |
| 9 | ওয়েবসাইট | Website | `/settings/website` | `settings.admin` |
| 10 | ওয়েবসাইটের বার্তা | Website Messages | `/settings/website-messages` | `settings.admin` |
| 11 | সিস্টেম ও ইনস্টলেশন | System & Installation | `/settings/license` | `settings.admin` |
| 12 | লাইসেন্স | License | `/license-verification` |  |

**মোট:** 15 টি গ্রুপ, 121 টি মেন্যু আইটেম (+ ড্যাশবোর্ড)। একই পাতা একাধিক গ্রুপে থাকতে পারে।

