# ۰۹. راه‌اندازی روی لیارا (Runbook)

این راهنما کارهای باقی‌مانده را به ترتیب اجرا می‌آورد. همهٔ مراحل از کامپیوتر خودتان و پنل لیارا انجام می‌شوند.

| برنامه | آدرس |
|---|---|
| PocketBase (بک‌اند) | `https://zarin-hoshmand-nieplltrhr.liara.run` (برنامهٔ `zarin-hoshmand-nieplltrhr`) |
| n8n (اتوماسیون) | `https://zarin-hoshmand-jexcz8u8pp.liara.run` |

| کار | وضعیت |
|---|---|
| Import هر چهار workflow در n8n | ✅ انجام شده (غیرفعال) |
| ۰. امنیت و ساخت سکرت مشترک | ⬜ |
| ۱. استقرار PocketBase و ساخت هتل | ⬜ |
| ۲. متغیرهای محیطی n8n | ⬜ |
| ۳. Credentialهای SMTP و Header Auth | ⬜ |
| ۴. فعال‌سازی workflowها | ⬜ |
| ۵. اتصال PocketBase به n8n | ⬜ |
| ۶. آزمون نهایی | ⬜ |

## ۰. امنیت و سکرت مشترک

1. رمز ورود n8n و API key ای که قبلاً در گفتگو ارسال شد را عوض و باطل کنید:
   - **Settings → Personal → Change password**
   - **Settings → n8n API**: کلید قبلی را حذف کنید. اگر بعداً به `import-workflows.mjs` نیاز داشتید، کلید تازه بسازید.
2. یک سکرت تصادفی بسازید. این همان کلید HMAC است که PocketBase و n8n هر دو باید داشته باشند:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   این مقدار فقط در متغیرهای محیطی لیارا قرار می‌گیرد. آن را در فایل‌های مخزن، تیکت یا گفتگو قرار ندهید.

## ۱. استقرار PocketBase و ساخت هتل

PocketBase باید اول آماده شود، چون n8n به آدرس آن و شناسهٔ هتل نیاز دارد.

1. مراحل ۱ تا ۶ بخش [لیارا در `pocketbase/README.md`](../pocketbase/README.md#لیارا-liara) را انجام دهید: برنامهٔ Docker، دیسک `pb-data`، `liara deploy` و حساب مدیر سرور.
2. **متغیرهای محیطی برنامهٔ PocketBase:**

   | متغیر | مقدار |
   |---|---|
   | `ZH_INTEGRATION_SECRET` | سکرت مرحلهٔ ۰ |
   | `ZH_AI_PROVIDER` | `none` (یا اصلاً تنظیم نکنید؛ پیش‌فرض همین است) |
   | `ZH_N8N_WEBHOOK_URL` | **هنوز تنظیم نکنید.** در مرحلهٔ ۵ اضافه می‌شود |
   | `ZH_PUSH_VIA_N8N` | خالی بگذارید. فعلاً هیچ workflowی رویداد `push.requested` را مصرف نمی‌کند |

   تا وقتی `ZH_N8N_WEBHOOK_URL` خالی است، هیچ رویدادی در صف (`outbox`) قرار نمی‌گیرد. پس پیش از آماده شدن n8n، صف پر نمی‌شود و پیام قدیمی هم ارسال نمی‌شود.
3. **بررسی:** آدرس `https://zarin-hoshmand-nieplltrhr.liara.run/v1/health` را در مرورگر باز کنید. پاسخ باید این باشد:
   ```json
   {"ok":true,"service":"zarin-hooshmand","backend":"pocketbase","version":1}
   ```
4. **ساخت هتل.** از پوشهٔ `pocketbase` روی کامپیوتر خودتان (Node 20 یا جدیدتر)، `npm install` و سپس یکی از دو راه زیر:
   - **هتل واقعی:** هتل و مدیرکل را می‌سازد. شناسهٔ هتل را چاپ می‌کند و آن را یادداشت کنید.
     ```bash
     ZH_PB_URL=https://zarin-hoshmand-nieplltrhr.liara.run \
     ZH_PB_SUPERUSER_EMAIL=… ZH_PB_SUPERUSER_PASSWORD=… \
     HOTEL_NAME="…" HOTEL_CITY="…" HOTEL_ROOMS=80 \
     GM_NATIONAL_ID=… GM_NAME="…" GM_TEMP_PASSWORD='…' \
     npm run create-hotel
     ```
     ```powershell
     # Windows PowerShell
     $env:ZH_PB_URL="https://zarin-hoshmand-nieplltrhr.liara.run"; $env:ZH_PB_SUPERUSER_EMAIL="…"; $env:ZH_PB_SUPERUSER_PASSWORD="…"
     $env:HOTEL_NAME="…"; $env:HOTEL_CITY="…"; $env:HOTEL_ROOMS="80"
     $env:GM_NATIONAL_ID="…"; $env:GM_NAME="…"; $env:GM_TEMP_PASSWORD="…"
     npm run create-hotel
     ```
   - **فقط برای دمو:** `npm run seed`، با همان سه متغیر `ZH_PB_*`. شناسهٔ هتل `zarintehran0001` است و ۱۶ کاربر نمونه با رمز `Zarin@2026` ساخته می‌شوند. روی سروری که دادهٔ واقعی هتل دارد اجرا نکنید.

## ۲. متغیرهای محیطی n8n

در پنل لیارا، برنامهٔ n8n ← «متغیرهای محیطی»، این‌ها را اضافه کنید. پس از ذخیره، برنامه restart می‌شود.

| متغیر | مقدار | کاربرد |
|---|---|---|
| `NODE_FUNCTION_ALLOW_BUILTIN` | `crypto` | امضا و بررسی HMAC در Code nodeها |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` | خواندن متغیرهای این جدول در workflowها (`$env`) |
| `GENERIC_TIMEZONE` | `Asia/Tehran` | منطقهٔ زمانی کل n8n. خود workflowها هم روی تهران تنظیم شده‌اند |
| `ZARIN_API_BASE` | `https://zarin-hoshmand-nieplltrhr.liara.run` | آدرس PocketBase، **بدون `/` در انتها** |
| `ZARIN_INTEGRATION_SECRET` | سکرت مرحلهٔ ۰ | باید دقیقاً برابر `ZH_INTEGRATION_SECRET` باشد |
| `ZARIN_HOTEL_IDS` | شناسهٔ هتل از مرحلهٔ ۱ | چند هتل را با `,` جدا کنید |
| `BALE_BOT_TOKEN` | توکن ربات بله | ربات را با BotFather در بله بسازید |
| `BALE_MANAGEMENT_CHAT_ID` | شناسهٔ گروه مدیریت | هشدارها و گزارش صبحگاهی |
| `BALE_MAINTENANCE_CHAT_ID` | شناسهٔ گروه تأسیسات | خرابی‌های high و critical |
| `BALE_ENERGY_CHAT_ID` | شناسهٔ گروه انرژی | ناهنجاری مصرف |
| `KAVENEGAR_API_KEY` | کلید API کاوه‌نگار | پیامک |
| `ONCALL_MANAGER_MOBILE` | مثلاً `0912…` | پیامک هشدار critical |
| `MAINTENANCE_MANAGER_MOBILE` | مثلاً `0912…` | پیامک Escalation خرابی critical |
| `PROCUREMENT_EMAIL` | ایمیل تدارکات | درخواست خرید وقتی موجودی کم است |
| `ZARIN_MAIL_FROM` | فرستندهٔ ایمیل‌ها | باید روی سرور SMTP مجاز باشد |
| `ZARIN_REPORT_RECIPIENTS` | ایمیل GM و مالک | با `,` جدا کنید |

- **شناسهٔ گروه‌های بله:** ربات را عضو گروه کنید و یک پیام در گروه بفرستید. سپس آدرس `https://tapi.bale.ai/bot<TOKEN>/getUpdates` را باز کنید. مقدار `message.chat.id` همان شناسهٔ گروه است.
- **همهٔ متغیرها لازم‌اند.** نودها مدیریت خطای جداگانه ندارند. برای مثال اگر کلید کاوه‌نگار خالی باشد، اجرای هشدار critical در نود پیامک متوقف می‌شود.
- اگر در Editor آدرس Webhookها با `localhost` نمایش داده شد، این متغیر را هم اضافه کنید: `WEBHOOK_URL=https://zarin-hoshmand-jexcz8u8pp.liara.run/`

## ۳. Credentialها

| Workflow | نود | نوع Credential | مقدار |
|---|---|---|---|
| Event router (۰۱) | *Purchase request e-mail* | SMTP | Host، Port، User و Password سرور ایمیل، و SSL/TLS متناسب با پورت |
| Daily management briefing (۰۲) | *E-mail GM & owner* | SMTP | همان Credential بالا |
| Smart meter ingestion (۰۴) | *Meter gateway webhook* | Header Auth | Name: `X-Meter-Key`، Value: یک مقدار تصادفی (با همان دستور مرحلهٔ ۰ بسازید) |

روش کار: workflow را باز کنید، روی نود دوبار کلیک کنید، از فهرست Credential گزینهٔ *Create new credential* را انتخاب کنید، مقادیر را وارد و ذخیره کنید، و در آخر workflow را ذخیره کنید. همان کلید `X-Meter-Key` را به گیت‌وی کنتورها بدهید.

## ۴. فعال‌سازی

workflowها را به این ترتیب Active کنید (در نسخه‌های جدید n8n با دکمهٔ **Publish**):

1. **۰۱ Event router** و **۰۴ Smart meter ingestion**. آدرس‌های production (`/webhook/…`) فقط وقتی workflow فعال است پاسخ می‌دهند.
2. **۰۳ Maintenance SLA escalation**، هر ۳۰ دقیقه.
3. **۰۲ Daily management briefing**، هر روز ساعت ۰۷:۱۵ به وقت تهران.

اگر Credential نودی تنظیم نشده باشد، n8n اجازهٔ فعال‌سازی نمی‌دهد. در این صورت مرحلهٔ ۳ را کامل کنید.

## ۵. اتصال PocketBase به n8n

حالا که ۰۱ فعال است، در برنامهٔ PocketBase این متغیر را اضافه کنید:

```
ZH_N8N_WEBHOOK_URL=https://zarin-hoshmand-jexcz8u8pp.liara.run/webhook/zarin-events
```

از این لحظه، رویدادها (هشدار، خرابی، کمبود موجودی، ناهنجاری انرژی) در صف `outbox` قرار می‌گیرند و هر دقیقه با امضای HMAC به n8n ارسال می‌شوند. اگر چند ارسال هم‌زمان رخ دهد، هر رویداد فقط یک بار تحویل داده می‌شود.

## ۶. آزمون نهایی

| # | کار | نتیجهٔ مورد انتظار | آنچه بررسی می‌شود |
|---|---|---|---|
| ۱ | در n8n، workflow ۰۲ را باز کنید و **Execute workflow** را بزنید | همهٔ نودها سبز می‌شوند. ایمیل گزارش به GM و مالک می‌رسد و پیام در گروه مدیریت بله ارسال می‌شود | `ZARIN_API_BASE`، سکرت، `ZARIN_HOTEL_IDS`، SMTP و بله |
| ۲ | workflow ۰۳ را دستی اجرا کنید | اجرا بدون خطا تمام می‌شود. اگر تیکتی بیش از ۶۰ دقیقه از SLA عقب باشد، اعلان درون‌برنامه‌ای برای مدیران ساخته می‌شود | مسیر امضاشدهٔ n8n به PocketBase |
| ۳ | در اپ یک خرابی با اولویت **critical** ثبت کنید | تا حدود ۱ دقیقه بعد: پیام در گروه تأسیسات و گروه مدیریت بله، و پیامک به مدیر کشیک | مسیر PocketBase ← n8n و امضای رویداد |
| ۴ | در پنل `/_/` PocketBase، مجموعهٔ `outbox` را باز کنید | ردیف‌های جدید `deliveredAt` دارند و `lastError` آن‌ها خالی است | تحویل رویدادها |
| ۵ | یک قرائت آزمایشی کنتور بفرستید (دستور زیر) | پاسخ HTTP 200. در `energyReadings` ردیفی با `source = smartMeter` ثبت می‌شود | Header Auth و ورود دادهٔ IoT |

دستور آزمون کنتور (`<KEY>` همان مقدار `X-Meter-Key` و `<HOTEL_ID>` شناسهٔ هتل است). برای هر هتل، هر روز و هر نوع مصرف فقط یک قرائت نگه داشته می‌شود و قرائت جدید جای قبلی را می‌گیرد. برای همین، آزمون روی تاریخ قدیمی `2020-01-01` انجام می‌شود که دادهٔ واقعی ندارد. پس از آزمون، این ردیف را از پنل حذف کنید:

```bash
curl -X POST https://zarin-hoshmand-jexcz8u8pp.liara.run/webhook/meter-readings \
  -H "content-type: application/json" -H "X-Meter-Key: <KEY>" \
  -d '{"readings":[{"hotelId":"<HOTEL_ID>","meterId":"TEST-E1","type":"electricity","day":"2020-01-01","value":1234.5}]}'
```
```powershell
# Windows PowerShell
Invoke-RestMethod -Method Post -Uri https://zarin-hoshmand-jexcz8u8pp.liara.run/webhook/meter-readings `
  -Headers @{ "X-Meter-Key" = "<KEY>" } -ContentType "application/json" `
  -Body '{"readings":[{"hotelId":"<HOTEL_ID>","meterId":"TEST-E1","type":"electricity","day":"2020-01-01","value":1234.5}]}'
```

## عیب‌یابی

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| در `outbox`، `lastError` برابر `HTTP 404` است | workflow ۰۱ فعال نیست، یا آدرس به‌جای `/webhook/` با `/webhook-test/` تنظیم شده | ۰۱ را فعال کنید و `ZH_N8N_WEBHOOK_URL` را اصلاح کنید |
| اجرای ۰۱ در نود *Verify signature* با `Invalid or stale Zarin signature` خطا می‌دهد | سکرت دو طرف برابر نیست، یا ساعت سرورها بیش از ۵ دقیقه اختلاف دارد | سکرت را در هر دو برنامه دوباره و دقیقاً یکسان تنظیم کنید |
| نود HTTP در ۰۲، ۰۳ یا ۰۴ پاسخ `401` با `invalid_signature` می‌گیرد | همان علت بالا، یا `ZH_INTEGRATION_SECRET` در PocketBase خالی است | همان راه‌حل بالا |
| نود HTTP پاسخ `404` می‌گیرد | `ZARIN_API_BASE` نادرست است یا `/` در انتها دارد، یا شناسهٔ هتل اشتباه است | مقدار را مطابق جدول مرحلهٔ ۲ اصلاح کنید |
| Code node خطای `Module 'crypto' is disallowed` می‌دهد | `NODE_FUNCTION_ALLOW_BUILTIN` تنظیم نشده | متغیر را اضافه کنید و n8n را restart کنید |
| خطای `access to env vars denied` | `N8N_BLOCK_ENV_ACCESS_IN_NODE` تنظیم نشده | مقدار را `false` بگذارید و restart کنید |
| Webhook کنتور پاسخ `403` می‌دهد | هدر `X-Meter-Key` نیست یا مقدارش اشتباه است | همان مقدار Credential را بفرستید |
| ردیف‌های `outbox` با `attempts = 8` تحویل نشده مانده‌اند | پس از ۸ تلاش ناموفق، ارسال متوقف می‌شود | علت را برطرف کنید، سپس در پنل `attempts` را `0` کنید تا ظرف یک دقیقه دوباره ارسال شود |
| پیام بله ارسال نمی‌شود (`400` یا `403`) | ربات عضو گروه نیست، یا شناسهٔ گروه اشتباه است | ربات را به گروه اضافه کنید و شناسه را دوباره از `getUpdates` بگیرید |
| ایمیل ارسال نمی‌شود | Host، Port یا TLS در Credential نادرست است، یا سرور SMTP اجازهٔ ارسال از آدرس `ZARIN_MAIL_FROM` را نمی‌دهد | تنظیمات SMTP و آدرس فرستنده را اصلاح کنید |

## به‌روزرسانی‌های بعدی

- **PocketBase:** در پوشهٔ `pocketbase` دستور `liara deploy` را اجرا کنید. migrationهای جدید هنگام شروع سرور خودکار اجرا می‌شوند. این نسخه migration تازهٔ `1759800000_outbox_lease.js` دارد که جلوی ارسال تکراری رویدادها را می‌گیرد.
- **workflowها:** اگر فایلی در `n8n/workflows` تغییر کند، دستور `node n8n/scripts/import-workflows.mjs` را با یک API key تازه اجرا کنید (راهنما در [`n8n/README.md`](../n8n/README.md#n8n-روی-لیارا)). این دستور workflowها را با نام پیدا و به‌روز می‌کند و Credentialهایی را که در Editor انتخاب کرده‌اید نگه می‌دارد. workflowهای فعال هم با نسخهٔ جدید دوباره منتشر می‌شوند.
