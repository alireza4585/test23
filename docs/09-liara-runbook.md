# ۰۹. راه‌اندازی روی لیارا (Runbook)

این راهنما وضعیت فعلی استقرار و کارهای باقی‌مانده را به ترتیب اجرا آورده است. دستورها یا روی Mac (zsh) اجرا می‌شوند، یا در «خط فرمان» برنامه در پنل لیارا. هر جا رمز یا کلید لازم باشد، دستور آن را از شما می‌پرسد. رمز و کلید را داخل دستور، فایل، تیکت یا پیام ننویسید.

| برنامه | آدرس | نوع |
|---|---|---|
| PocketBase (بک‌اند) | `https://zarin-hoshmand-nieplltrhr.liara.run` | برنامهٔ آمادهٔ PocketBase 0.40.4 با دیسک دائمی |
| n8n (اتوماسیون) | `https://zarin-hoshmand-jexcz8u8pp.liara.run` | n8n 2.26.2 |

## وضعیت فعلی

| کار | وضعیت |
|---|---|
| PocketBase بالا است و hookها و migrationها روی دیسک آن کپی شده‌اند | ✅ |
| superuser ساخته شده | ✅ |
| `ZH_INTEGRATION_SECRET` در PocketBase و `ZARIN_INTEGRATION_SECRET` در n8n | ✅ باید عوض شود ([چک‌لیست امنیتی](#۹-چکلیست-امنیتی)) |
| دادهٔ دمو (`npm run seed`): هتل `zarintehran0001` و ۱۶ حساب با رمز عمومی | ⚠️ پیش از استفادهٔ واقعی پاک شود (مرحلهٔ ۳) |
| n8n: هر چهار workflow import شده (غیرفعال) و متغیرهای پایه تنظیم شده | ✅ |
| اتصال امضاشدهٔ n8n به PocketBase (`GET /v1/hotels/zarintehran0001/summary`) | ✅ تست شده |
| به‌روزرسانی hookها و workflowها به نسخهٔ جدید | ⬜ مرحله‌های ۲ و ۴ |
| کانال‌ها (بله، پیامک، ایمیل) و Header Auth | ⬜ اختیاری و یکی‌یکی (مرحلهٔ ۵) |
| فعال‌سازی workflowها و `ZH_N8N_WEBHOOK_URL` | ⬜ مرحله‌های ۶ و ۷ |

## ۱. آماده‌سازی Mac (یک بار)

1. **مخزن:**
   ```zsh
   git clone https://github.com/alireza4585/test23.git ~/zarin
   cd ~/zarin && git checkout claude/awesome-ramanujan-cvthpx
   ```
   اگر قبلاً clone کرده‌اید، فقط `cd ~/zarin && git pull` را اجرا کنید.
2. **Node:** اسکریپت‌های این راهنما با Node 18 کار می‌کنند و ارتقا لازم نیست. فقط اجرای تست‌های خودکار مخزن Node 22 لازم دارد (`brew install node@22`).
3. **وابستگی‌ها:** این دستور فقط SDK خود PocketBase را نصب می‌کند:
   ```zsh
   cd ~/zarin/pocketbase && npm ci --omit=dev
   ```
4. **الگوی واردکردن رمز در zsh:** با `read -s "VAR?Prompt: "` چیزی که تایپ می‌کنید روی صفحه نمایش داده نمی‌شود و در history هم نمی‌ماند. پس از پایان کار، متغیر را با `unset VAR` پاک کنید. در bash معادل آن `read -rsp "Prompt: " VAR` است.
5. **ساخت سکرت یا کلید تصادفی:** `openssl rand -hex 32 | pbcopy`. مقدار مستقیم در clipboard قرار می‌گیرد و روی صفحه نمایش داده نمی‌شود. آن را در فیلد مقصد paste کنید.

## ۲. به‌روزرسانی hookها و migrationهای PocketBase

برنامهٔ PocketBase از ایمیج آمادهٔ لیارا اجرا می‌شود و hookها و migrationهای این مخزن روی دیسک‌های آن قرار دارند:

| مسیر روی سرور | محتوا |
|---|---|
| `/usr/local/bin/pocketbase` | فایل اجرایی |
| `/pb_data` | دیتابیس و فایل‌ها |
| `/pb_hooks` و `/pb_migrations` | کپی `pocketbase/pb_hooks` و `pocketbase/pb_migrations` |

در پنل لیارا، برنامهٔ PocketBase ← «خط فرمان»، این دستور را اجرا کنید:

```sh
B=claude/awesome-ramanujan-cvthpx
cd /tmp && rm -rf test23-* s.tgz \
  && wget -qO s.tgz "https://codeload.github.com/alireza4585/test23/tar.gz/refs/heads/$B" \
  && tar xzf s.tgz \
  && cp -r test23-*/pocketbase/pb_migrations/. /pb_migrations/ \
  && cp -r test23-*/pocketbase/pb_hooks/. /pb_hooks/ \
  && rm -rf test23-* s.tgz && echo "copied"
```

- **این نسخه برای مرحلهٔ ۳ لازم است.** در نسخهٔ قبلی، حذف هتل از طریق API با خطا تمام می‌شد. همچنین migration `1759800000_outbox_lease` جلوی ارسال تکراری رویدادها به n8n را می‌گیرد.
- migrationها عمداً **قبل از** hookها کپی می‌شوند. PocketBase تغییر `/pb_hooks` را خودش تشخیص می‌دهد، restart می‌شود و هنگام شروع migrationهای جدید را اجرا می‌کند.
- **بررسی:**
  1. `/v1/health` باید `{"ok":true,…}` برگرداند.
  2. در پنل `/_/` ← Collections ← `outbox`، باید فیلد `lockedUntil` وجود داشته باشد. اگر نبود، برنامه را از پنل لیارا یک بار «راه‌اندازی مجدد» کنید.
- **`liara deploy` را روی این برنامه اجرا نکنید.** این کار ایمیج آماده را با `Dockerfile` مخزن جایگزین می‌کند و برنامه با دیتابیس خالی بالا می‌آید. جزئیات در [`pocketbase/README.md`](../pocketbase/README.md#لیارا-liara) آمده است.
- **طرح دیتابیس را از پنل `/_/` تغییر ندهید.** این ایمیج احتمالاً automigrate روشن دارد و هر تغییر در پنل، فایل migration تازه‌ای می‌سازد که با migrationهای مخزن تداخل پیدا می‌کند.

## ۳. پاک کردن دادهٔ دمو و ساخت هتل واقعی

رمز همهٔ حساب‌های دمو (`Zarin@2026`) در همین مخزن منتشر شده است، از جمله یک حساب superAdmin. تا وقتی دادهٔ دمو روی این آدرس عمومی است، هر کسی می‌تواند با آن وارد شود. پس پیش از استفادهٔ واقعی، و بهتر است همین حالا، آن را پاک کنید. مرحلهٔ ۲ باید قبل از این کار انجام شده باشد.

```zsh
cd ~/zarin/pocketbase
export ZH_PB_URL=https://zarin-hoshmand-nieplltrhr.liara.run
read "ZH_PB_SUPERUSER_EMAIL?Superuser email: "
read -s "ZH_PB_SUPERUSER_PASSWORD?Superuser password: "; echo
export ZH_PB_SUPERUSER_EMAIL ZH_PB_SUPERUSER_PASSWORD

npm run reset-demo            # فقط نشان می‌دهد چه چیزی پاک می‌شود
npm run reset-demo -- --yes   # هتل دمو، همهٔ داده‌هایش و ۱۶ حساب دمو را پاک می‌کند
```

- فهرست dry run را بخوانید. باید فقط هتل «هتل بزرگ زرین» و ۱۶ حساب دمو در آن باشد. هتل‌های دیگر و حساب superuser پاک نمی‌شوند.
- اگر خطای `Too Many Requests` گرفتید، محدودیت تعداد ورود است. چند ثانیه صبر کنید و دوباره اجرا کنید.

سپس هتل واقعی و مدیرکل آن را بسازید (در همان ترمینال):

```zsh
read "GM_NATIONAL_ID?GM national ID: "
read -s "GM_TEMP_PASSWORD?GM temporary password (8+ chars, letters and digits): "; echo
export GM_NATIONAL_ID GM_TEMP_PASSWORD
HOTEL_NAME="…" HOTEL_CITY="…" HOTEL_ROOMS=80 GM_NAME="…" npm run create-hotel
unset ZH_PB_SUPERUSER_PASSWORD GM_TEMP_PASSWORD
```

- خروجی دستور یک خط `ZARIN_HOTEL_IDS=<شناسه>` چاپ می‌کند. این مقدار را در n8n به‌جای `zarintehran0001` بگذارید.
- مدیرکل با کد ملی و رمز موقت وارد اپ می‌شود، رمز را عوض می‌کند و بقیهٔ کاربران را از داخل اپ می‌سازد.

## ۴. به‌روزرسانی workflowها در n8n

workflowهای فعلی n8n نسخهٔ قبلی‌اند. نسخهٔ جدید هر کانالی را که متغیرهایش خالی است رد می‌کند و نودهای ایمیل را خاموش دارد، تا بتوانید workflowها را پیش از راه‌اندازی کانال‌ها فعال کنید.

1. در n8n، Settings ← n8n API ← یک API key بسازید.
2. روی Mac:
   ```zsh
   cd ~/zarin
   export N8N_URL=https://zarin-hoshmand-jexcz8u8pp.liara.run
   read -s "N8N_API_KEY?n8n API key: "; echo; export N8N_API_KEY
   node n8n/scripts/import-workflows.mjs
   unset N8N_API_KEY
   ```
   انتظار می‌رود برای هر چهار workflow خطی با `updated` چاپ شود. برای ۰۱ و ۰۲ یادداشت `switched off until SMTP is set` و برای ۰۴ یادداشت `set credentials before activating` هم می‌آید.
3. اگر کلید را فقط برای همین کار ساخته‌اید، آن را در n8n حذف کنید.

روش دستی بدون API key: هر workflow را باز کنید، از منوی ⋯ گزینهٔ *Import from File* را بزنید، فایل همان workflow را از `n8n/workflows` انتخاب کنید و Save کنید.

## ۵. متغیرهای n8n و کانال‌ها (یکی‌یکی)

متغیرها را در پنل لیارا، برنامهٔ n8n ← «متغیرهای محیطی» تنظیم کنید. پس از ذخیره، برنامه restart می‌شود.

| متغیر | وضعیت | مقدار |
|---|---|---|
| `NODE_FUNCTION_ALLOW_BUILTIN` | ✅ | `crypto` |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | ✅ | `false` |
| `GENERIC_TIMEZONE` | ✅ | `Asia/Tehran` |
| `ZARIN_API_BASE` | ✅ | `https://zarin-hoshmand-nieplltrhr.liara.run`، بدون `/` در انتها |
| `ZARIN_INTEGRATION_SECRET` | ✅ | برابر `ZH_INTEGRATION_SECRET` در PocketBase |
| `ZARIN_HOTEL_IDS` | ✅ پس از مرحلهٔ ۳ عوض شود | شناسهٔ هتل واقعی. چند هتل را با `,` جدا کنید |
| `ZARIN_MAIL_FROM`، `ZARIN_REPORT_RECIPIENTS` | ✅ | فرستنده، و ایمیل GM و مالک |
| `BALE_BOT_TOKEN`، `BALE_MANAGEMENT_CHAT_ID`، `BALE_MAINTENANCE_CHAT_ID`، `BALE_ENERGY_CHAT_ID` | ⬜ | توکن ربات و **شناسهٔ عددی** هر گروه |
| `KAVENEGAR_API_KEY`، `ONCALL_MANAGER_MOBILE`، `MAINTENANCE_MANAGER_MOBILE` | ⬜ | کلید کاوه‌نگار و شماره‌ها (`0912…`) |
| `PROCUREMENT_EMAIL` | ⬜ | ایمیل تدارکات |

هر کانال مستقل است. تا وقتی متغیرهای یک کانال خالی‌اند، شاخهٔ همان کانال رد می‌شود و بقیهٔ workflow بدون خطا اجرا می‌شود. جزئیات هر کانال در [بخش «کانال‌ها» در `n8n/README.md`](../n8n/README.md#کانالها-یکییکی-فعال-کنید) آمده است:

- **بله:** شناسهٔ چت باید عدد باشد (از `getUpdates`)، نه نام کاربری.
- **ایمیل:**
  1. یک Credential SMTP بسازید. Gmail فقط با App Password کار می‌کند و از سرور داخل ایران ممکن است ناپایدار باشد؛ سرویس ایمیل لیارا جایگزین پیشنهادی است.
  2. Credential را روی نودهای *Purchase request e-mail* و *E-mail GM & owner* انتخاب کنید.
  3. این دو نود را روشن کنید (کلید `D`).
- **Header Auth برای ۰۴:**
  1. کلید را با `openssl rand -hex 32 | pbcopy` بسازید.
  2. در n8n ← Credentials یک Header Auth با Name برابر `X-Meter-Key` و Value برابر همین کلید بسازید.
  3. آن را روی نود *Meter gateway webhook* انتخاب کنید.
  4. همین کلید را فقط به گیت‌وی کنتورها بدهید.

## ۶. فعال‌سازی (Publish)

1. **۰۱ Event router**
2. **۰۳ Maintenance SLA escalation**: هر ۳۰ دقیقه
3. **۰۲ Daily management briefing**: هر روز ساعت ۰۷:۱۵ به وقت تهران
4. **۰۴ Smart meter ingestion**: فقط پس از تنظیم Header Auth. n8n بدون آن اجازهٔ Publish نمی‌دهد.

اگر Publish خطای «1 node has issues» داد، یا یک نود ایمیل بدون Credential روشن است، یا ۰۴ بدون Header Auth است.

## ۷. اتصال PocketBase به n8n

پس از Publish شدن ۰۱، در برنامهٔ **PocketBase** این متغیر را اضافه کنید:

```
ZH_N8N_WEBHOOK_URL=https://zarin-hoshmand-jexcz8u8pp.liara.run/webhook/zarin-events
```

از این لحظه، رویدادها (هشدار، خرابی، کمبود موجودی، ناهنجاری انرژی) در صف `outbox` قرار می‌گیرند و هر دقیقه، هر کدام فقط یک بار، با امضای HMAC به n8n ارسال می‌شوند. تا وقتی این متغیر خالی است، هیچ رویدادی در صف نمی‌ماند.

`ZH_PUSH_VIA_N8N` را خالی بگذارید. هنوز workflowی رویداد `push.requested` را مصرف نمی‌کند.

## ۸. آزمون نهایی

| # | کار | نتیجهٔ مورد انتظار |
|---|---|---|
| ۱ | workflow ۰۲ را باز کنید و **Execute workflow** را بزنید | همهٔ نودها بدون خطا اجرا می‌شوند و نود *GET summary + AI briefing* شاخص‌ها را نشان می‌دهد. برای کانال‌هایی که هنوز تنظیم نشده‌اند، داده به خروجی `false` نود گیت می‌رود؛ این رفتار درست است |
| ۲ | در اپ یک خرابی با اولویت **critical** ثبت کنید | حدود ۱ دقیقه بعد، در n8n ← Executions یک اجرای موفق ۰۱ دیده می‌شود. اگر بله و پیامک تنظیم شده باشند، پیام در گروه تأسیسات و مدیریت می‌رسد و پیامک به مدیر کشیک ارسال می‌شود |
| ۳ | در پنل `/_/`، مجموعهٔ `outbox` را باز کنید | ردیف‌های جدید `deliveredAt` دارند و `lastError` آن‌ها خالی است |
| ۴ | پس از Header Auth، یک قرائت آزمایشی بفرستید (دستور زیر) | پاسخ HTTP 200. در `energyReadings` ردیفی با تاریخ `2020-01-01` و `source = smartMeter` ثبت می‌شود. پس از آزمون آن را پاک کنید |

برای هر هتل، روز و نوع مصرف فقط یک قرائت نگه داشته می‌شود و قرائت جدید جای قبلی را می‌گیرد. برای همین آزمون روی تاریخ قدیمی `2020-01-01` انجام می‌شود:

```zsh
read -s "METER_KEY?X-Meter-Key: "; echo
read "HOTEL_ID?Hotel ID: "
curl -sS -X POST https://zarin-hoshmand-jexcz8u8pp.liara.run/webhook/meter-readings \
  -H "content-type: application/json" -H "X-Meter-Key: $METER_KEY" \
  -d "{\"readings\":[{\"hotelId\":\"$HOTEL_ID\",\"meterId\":\"TEST-E1\",\"type\":\"electricity\",\"day\":\"2020-01-01\",\"value\":1234.5}]}"
unset METER_KEY
```

## ۹. چک‌لیست امنیتی

- [ ] **دادهٔ دمو پاک شده است** (مرحلهٔ ۳). تا آن زمان ۱۶ حساب با رمز عمومی، از جمله یک superAdmin، روی آدرس عمومی فعال‌اند.
- [ ] **رمز n8n عوض شده است** (Settings ← Personal). API keyهای قدیمی، از جمله کلیدی که پیش‌تر در گفتگو ارسال شد، در Settings ← n8n API حذف شده‌اند.
- [ ] **رمز superuser PocketBase عوض شده است** (`/_/` ← Superusers).
- [ ] **سکرت یکپارچه‌سازی عوض شده است:**
  1. مقدار تازه را با `openssl rand -hex 32 | pbcopy` بسازید.
  2. همان مقدار را در PocketBase به‌عنوان `ZH_INTEGRATION_SECRET` و در n8n به‌عنوان `ZARIN_INTEGRATION_SECRET` بگذارید.

  بین تغییر دو برنامه، درخواست‌های امضاشده رد می‌شوند. رویدادهای صف هر دقیقه دوباره ارسال می‌شوند (تا ۸ بار)، پس هر دو را ظرف چند دقیقه عوض کنید.
- [ ] **workflowهای آزمایشی TEMP حذف شده‌اند:** Workflows ← نمایش بایگانی‌شده‌ها ← Delete.
- [ ] **workflow ۰۴ بدون Header Auth فعال نشده است** (n8n هم اجازه نمی‌دهد)، و کلید `X-Meter-Key` فقط به گیت‌وی کنتور داده شده است.
- [ ] **ساختار سرور دست نخورده است:** طرح دیتابیس از پنل `/_/` تغییر نکرده و `liara deploy` روی برنامهٔ PocketBase اجرا نشده است.
- [ ] **پشتیبان روزانهٔ PocketBase فعال است** (`/_/` ← Settings ← Backups).
- [ ] **هیچ رمز، توکن یا کلیدی جای ناامن نیست:** نه در مخزن، نه در فایل، نه در پیام، و نه در history ترمینال (همیشه `read -s`).

## عیب‌یابی

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| Publish خطای «1 node has issues» می‌دهد | نود ایمیل بدون Credential روشن است، یا ۰۴ بدون Header Auth است | Credential را تنظیم کنید یا نود ایمیل را خاموش کنید (`D`) |
| نود گیت («… configured?») با وجود تنظیم متغیر، داده را به `false` می‌فرستد | نام متغیر اشتباه است، یا n8n پس از تنظیم restart نشده | نام را با جدول مرحلهٔ ۵ مقایسه کنید و برنامه را restart کنید |
| `npm run reset-demo` هنگام حذف هتل خطا می‌دهد | hookهای سرور قدیمی‌اند | مرحلهٔ ۲ را انجام دهید و دوباره اجرا کنید |
| اسکریپت‌ها `Too Many Requests` می‌دهند | محدودیت تعداد ورود PocketBase | چند ثانیه صبر کنید |
| اسکریپت‌ها `missing ZH_PB_URL` یا متغیر دیگری می‌دهند | `export` در همان ترمینال اجرا نشده | دستورهای `export` و `read` را دوباره اجرا کنید |
| در `outbox`، `lastError` برابر `HTTP 404` است | ۰۱ منتشر نشده، یا آدرس به‌جای `/webhook/` با `/webhook-test/` تنظیم شده | ۰۱ را Publish کنید و `ZH_N8N_WEBHOOK_URL` را اصلاح کنید |
| اجرای ۰۱ در *Verify signature* با `Invalid or stale Zarin signature` خطا می‌دهد | سکرت دو برنامه برابر نیست، یا ساعت سرورها بیش از ۵ دقیقه اختلاف دارد | سکرت را در هر دو برنامه دقیقاً یکسان تنظیم کنید |
| نود HTTP پاسخ `401 invalid_signature` می‌گیرد | همان علت بالا، یا `ZH_INTEGRATION_SECRET` در PocketBase خالی است | همان راه‌حل بالا |
| نود HTTP پاسخ `404` می‌گیرد | `ZARIN_API_BASE` یا شناسهٔ هتل نادرست است | جدول مرحلهٔ ۵ را بررسی کنید |
| Code node خطای `Module 'crypto' is disallowed` می‌دهد | `NODE_FUNCTION_ALLOW_BUILTIN` تنظیم نشده | متغیر را اضافه و restart کنید |
| خطای `access to env vars denied` | `N8N_BLOCK_ENV_ACCESS_IN_NODE` تنظیم نشده | مقدار را `false` بگذارید و restart کنید |
| ردیف‌های `outbox` با `attempts = 8` تحویل نشده مانده‌اند | پس از ۸ تلاش ناموفق، ارسال متوقف می‌شود | علت را برطرف کنید و در پنل `attempts` را `0` کنید |
| پیام بله ارسال نمی‌شود (`400` یا `403`) | ربات عضو گروه نیست، یا شناسهٔ چت عددی نیست | ربات را اضافه کنید و شناسه را از `getUpdates` بگیرید |
| ایمیل ارسال نمی‌شود | تنظیمات SMTP نادرست است، Gmail بدون App Password است، یا سرور SMTP از ایران در دسترس نیست | از سرویس ایمیل لیارا استفاده کنید |

## روش جایگزین: برنامهٔ Docker

اگر روزی بخواهید PocketBase را به‌جای ایمیج آماده از `Dockerfile` همین مخزن بسازید، یک برنامهٔ Docker **جدید** بسازید و مراحل بخش «روش جایگزین» در [`pocketbase/README.md`](../pocketbase/README.md#لیارا-liara) را دنبال کنید. این روش را روی برنامهٔ فعلی اجرا نکنید.

## به‌روزرسانی‌های بعدی

- **PocketBase:** پس از هر تغییر در `pocketbase/pb_hooks` یا `pocketbase/pb_migrations`، دستور مرحلهٔ ۲ را دوباره اجرا کنید.
- **workflowها:** پس از هر تغییر در `n8n/workflows`، مرحلهٔ ۴ را تکرار کنید. Credentialها و روشن بودن نودهای ایمیل حفظ می‌شوند.
