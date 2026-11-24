# Chat History — পল্লী সমবায় সমিতি + কৃষি সেচ ERP (Polsha)

> **কোন কথোপকথন আছে:** এই কম্পিউটারে (`C:\Users\Administrator\.claude\projects\f--Lovable-polsha\`) এই প্রজেক্টের একটিই Claude Code session-এর রেকর্ড আছে — ০৫/১১/২০২৬ থেকে ২৪/১১/২০২৬। তার আগে সফটওয়্যার তৈরির (২৩/০৯ – ২৯/১০/২০২৬) কথোপকথন এই কম্পিউটারে নেই; সেই সময়ে কী তৈরি হয়েছে তা [development.md](development.md)-এ git history থেকে লেখা।
>
> **গোপনীয়তা:** ব্যবহারকারীর পাঠানো SSH পাসওয়ার্ড এখানে `••••••` দিয়ে ঢাকা। পাসওয়ার্ডটি চ্যাটে পাঠানো হয়েছে, তাই cPanel থেকে বদলে নেওয়া উচিত।

---

## Session: ০৫/১১/২০২৬ – ২৪/১১/২০২৬

### ১. রিপোজিটরির লিংক (০৫/১১)

**ব্যবহারকারী:**
> https://github.com/snsbd247/polsha.git

**Claude:**
- দেখল `F:\Lovable\polsha`-এ রিপোজিটরি আগে থেকেই clone করা, `origin` = এই URL, branch `main`, working tree পরিষ্কার।
- README পড়ে জানাল: React (Vite + TS + Ant Design) + Laravel 12 API, cPanel-এ deploy, ফেজ ১–১২ সম্পন্ন।
- জানাল PowerShell-এ `git` PATH-এ নেই; জিজ্ঞেস করল রিপো দিয়ে কী করতে হবে।

### ২. লাইভ থেকে লোকালে সেটআপ (০৫/১১)

**ব্যবহারকারী:**
> SSH IP: 163.227.239.146 · Username: pmwmcs · Password: •••••• · File path: /home/pmwmcs/public_html
>
> এখান থেকে নিয়ে লোকালে ডাটাবেজ তৈরি করে সেটাপ করে দেন আমি যেনো লোকাল এও ব্রাউজ বা এক্সেস করতে পারি।
> এভাবে এক্সেস করবো: localhost/polsha · 192.168.0.171/polsha · http://160.25.9.132/polsha

**Claude যা করল:**
1. লোকালে খুঁজে পেল: `F:\Lovable\xampp` (PHP 8.2.12, MariaDB 10.4.32), আগের সাব-পাথ build `F:\Lovable\polsha-web`, পুরোনো dump `F:\Lovable\polsha-db\live-20261004-1835.sql.gz`, backend-এ `vendor` ও `.env`। Node/Composer/Git PowerShell-এ নেই।
2. Windows OpenSSH (9.5) দিয়ে `SSH_ASKPASS` ব্যবহার করে পাসওয়ার্ডে লগইন। PowerShell pipe BOM/CRLF যোগ করে, তাই remote script `scp` দিয়ে পাঠিয়ে চালানো।
3. সার্ভারের কাঠামো: `~/public_html` (frontend), `~/polsha/backend` (Laravel), DB `pmwmcs_polsha`, ডোমেইন `https://pmpbssl.com`, PHP 8.2.35, MariaDB 10.11.18।
4. লাইভ ও লোকালের কোড মিলিয়ে দেখল — ৫৬টি migration, `routes/api.php` ও `composer.lock`-এর hash একই। তাই শুধু ডেটা আনা দরকার।
5. সার্ভারে `mysqldump` (১০১টি টেবিল) ও `storage/app` (ব্যাকআপ বাদে) tar → ডাউনলোড `F:\Lovable\polsha-db\pmpbssl-20261105\` → সার্ভারের অস্থায়ী ফাইল মুছল।
6. MariaDB চালু করে `polsha` ডাটাবেজ তৈরি; dump-এর প্রথম লাইন (`/*M!999999\- enable the sandbox mode */`, 10.4 বোঝে না) বাদ দিয়ে import — ১০১টি টেবিল, ৫৬টি migration মিলেছে। লাইভে তখন ০ কৃষক, ইউজার শুধু `admin`।
7. লোকাল `storage/app`-এর ব্যাকআপ নিয়ে লাইভের লোগো ও ওয়েবসাইটের ছবি বসাল।
8. backend `.env`: `DB_PORT=3306`, `DB_DATABASE=polsha`, `FRONTEND_URL`-এ তিনটি ঠিকানা; আগের `.env`-এর কপি রাখল।
9. PHP-তে `intl`, `gd`, `zip` চালু (`php.ini.bak-polsha` রেখে)।
10. Apache-এ `conf/extra/httpd-polsha.conf` (`Alias /polsha "F:/Lovable/polsha-web"`, `AllowOverride All`) ও `httpd.conf`-এ Include; Apache চালু।
11. যাচাই: তিন ঠিকানাতেই হোম, `/polsha/api/public/settings` ও `/polsha/dashboard` → 200।
12. Windows Firewall-এ পোর্ট 80 খোলার চেষ্টা — অনুমতি ব্যবস্থা আটকে দিল।
13. লাইসেন্স দেখল: `license_state` ডোমেইন `pmpbssl.com`-এ বাঁধা → লোকালে `blocked / domain`, অর্থাৎ লগইন হবে কিন্তু signed-in কাজ বন্ধ। লাইসেন্স কোড ইচ্ছা করেই বন্ধ করা যায় না, তাই হাত দেয়নি।

**Claude-এর উত্তরের সারাংশ:** তিন ঠিকানা চালু; বাকি — (১) লোকাল ঠিকানার জন্য লাইসেন্স key, (২) Firewall-এ পোর্ট 80 (কমান্ড দেওয়া হলো), (৩) রিস্টার্টের পর XAMPP চালু করা বা Service বানানো, (৪) SSH পাসওয়ার্ড বদলানো।

### ৩. আবার সেটআপ (২৪/১১)

**ব্যবহারকারী:**
> local এ সেটাপ করেন এভাবে এক্সেস করবো
> localhost/polsha · 192.168.0.171/polsha · 160.25.9.132/polsha

**Claude:**
- দেখল Apache ও MySQL চলছে (Windows Service, Automatic); তিন ঠিকানায় হোম, লগইন ও API → 200। নতুন করে কিছু করার দরকার নেই।

**ব্যবহারকারী (কাজের মাঝে):**
> জা জা করা লাগএব আপনি করেন

**Claude:**
- Firewall rule আবার চেষ্টা করল — আবার আটকাল। বদলে `F:\Lovable\polsha-db\open-firewall-port80.bat` বানাল (Administrator হিসেবে চালাতে হবে)।
- লোকালে ০৫/১১-এর পর কোনো কাজ হয়নি দেখে লাইভ থেকে ডেটা হালনাগাদের চেষ্টা করল — পুরোনো IP `163.227.239.146` কোনো পোর্টে সাড়া দেয় না।
- `pmpbssl.com` এখন `169.40.116.146`-এ (srv3.syncsolutionbd.com); সেখানে একই অ্যাকাউন্টে লগইন হলো, কিন্তু ব্যবহারকারী এই IP দেননি বলে dump নেওয়া অনুমতি ব্যবস্থা আটকাল।
- ব্যবহারকারীর কাছে নতুন IP-র অনুমতি চাইল; লাইসেন্সের বিষয়টি আবার বুঝিয়ে বলল।

### ৪. পাঁচটি ডকুমেন্ট (২৪/১১)

**ব্যবহারকারী:**
> কাজ শেষ হলে ৫টা .md ফাইল তৈরি করেন
> - Database.md (পুরো ডাটাবেজ এর স্কেমা লিখা থাকবে, সাথে রিলেশন, ইন্ডেক্স সব কিছু থাকবে)
> - plan.md (এই সফটওয়্যার এর পুরো প্ল্যান থাকবে কিভাবে কোন মডিউল কাজ করবে কোন মডিউল এর কি কাজ সব লিখা থাকবে)
> - UI.md (এই সফটওয়্যার এবং ওয়েবসাইট পুরোটার UI ডিজাইন থাকবে)
> - chat_history.md (এই প্রজেক্ট এর পুরো চ্যাট হিস্টরি থাকবে)
> - development.md (এই প্রজেক্ট এর পুরো ডেভেলপমেন্ট হিস্ট্রি থাকবে)

**ব্যবহারকারী (কাজের মাঝে):**
> SSH IP: 169.40.116.146 · Username: pmwmcs · Password: •••••• · File path: /home/pmwmcs/public_html

**Claude যা করল:**
1. নতুন সার্ভার থেকে dump ও `storage/app` নিল; কোড এখনো একই (৫৬ migration, একই hash, একই frontend bundle `index-DBw4H7aJ.js`)।
2. লোকাল DB-র ব্যাকআপ (`F:\Lovable\polsha-db\pmpbssl-20261124\local-before-refresh.sql`) নিয়ে নতুন ডেটা import — ১০১টি টেবিল, ৯৫টি audit entry (শেষ ২৪/১১), লাইভে এখনো ০ কৃষক। সার্ভারের অস্থায়ী ফাইল মুছল।
3. **Database.md** — লোকাল ডাটাবেজের `information_schema` থেকে script দিয়ে তৈরি: ১০১টি টেবিল, ১,১৯৬টি কলাম, ৪২৫টি ইন্ডেক্স, ২১৪টি Foreign Key, ৮৬টি মডেলের Eloquent সম্পর্ক; মডিউলভিত্তিক তালিকা ও Mermaid ER চিত্র।
4. **plan.md** — README, `config/erp.php`, services, approval handler, Chart of Accounts ও cron schedule থেকে: কেন্দ্রীয় ইঞ্জিন, ২০টি মডিউল, Posting নিয়ম, Role, deploy।
5. **UI.md** — `AppLayout.tsx`, CSS, পাতা ও কম্পোনেন্ট থেকে: রং, ফন্ট, লেআউট, পাতার ধরন, ড্যাশবোর্ড, রশিদ, ওয়েবসাইট, রেস্পন্সিভ, পুরো ১২১-আইটেমের মেন্যু।
6. **development.md** — git-এর ৮৯টি commit, README-এর অগ্রগতি ও সার্ভারের কাজ থেকে সময়রেখা।
7. **chat_history.md** — এই ফাইল।

### ৫. ফায়ারওয়াল (২৪/১১)

**ব্যবহারকারী:**
> ফায়ারওয়াল: F:\Lovable\polsha-db\open-firewall-port80.bat ফাইলে right-click করে "Run as administrator" korechi

**Claude:**
- যাচাই করল: rule "Polsha - Apache HTTP (TCP 80)" চালু (Inbound, Allow, সব profile)। ফাইলটি দুবার চলায় একই নামের rule দুটো হয়েছে, এতে কোনো সমস্যা নেই।
- localhost, 192.168.0.171 ও 160.25.9.132 — তিনটিতেই API → 200।
- plan.md, development.md ও এই ফাইলে ফায়ারওয়ালের কাজ সম্পন্ন হিসেবে লেখা হলো।

---

## এই session-এ তৈরি / বদলানো ফাইল

| ফাইল | কী |
|---|---|
| `F:\Lovable\xampp\apache\conf\extra\httpd-polsha.conf` | নতুন — `/polsha` Alias |
| `F:\Lovable\xampp\apache\conf\httpd.conf` | Include যোগ (`httpd.conf.bak-polsha` রাখা) |
| `F:\Lovable\xampp\php\php.ini` | `intl`, `gd`, `zip` চালু (`php.ini.bak-polsha` রাখা) |
| `F:\Lovable\polsha\backend\.env` | DB পোর্ট/নাম, `FRONTEND_URL` |
| `F:\Lovable\polsha\backend\storage\app\` | লাইভের আপলোড করা ফাইল |
| `F:\Lovable\polsha-db\pmpbssl-20261105\`, `pmpbssl-20261124\` | লাইভের dump, ফাইল ও লোকালের আগের অবস্থার ব্যাকআপ |
| `F:\Lovable\polsha-db\open-firewall-port80.bat` | পোর্ট 80 খোলার ফাইল |
| `Database.md`, `plan.md`, `UI.md`, `chat_history.md`, `development.md` | এই পাঁচটি ডকুমেন্ট (রিপোর মূলে; এখনো commit করা হয়নি) |
