# n8n — لایهٔ اتوماسیون زرین هوشمند

n8n «سیستم عصبی» پلتفرم است. رویدادهای عملیاتی را از بک‌اند می‌گیرد و به کانال‌های بیرونی می‌فرستد (بله، پیامک، ایمیل). کارهای زمان‌بندی‌شده را اجرا می‌کند (گزارش صبحگاهی، Escalation). داده‌های IoT را هم وارد پلتفرم می‌کند.

منطق کسب‌وکار در n8n نیست. منطق در Cloud Functions و موتور تحلیل است و n8n فقط **ارکستراسیون و اتصال** را انجام می‌دهد. پس می‌توان n8n را عوض کرد، مثلاً با Temporal یا یک worker اختصاصی، بدون اینکه اپ یا قوانین امنیتی تغییر کنند.

```
Flutter ──► Firestore ──► Cloud Functions (triggers, analytics, AI)
                               │  emitEvent()  HMAC-signed
                               ▼
                         n8n /webhook/zarin-events ──► Bale · SMS · E-mail
                               ▲
   n8n schedules ──signed──► /v1 API (summary, overdue, notifications, readings)
   Smart meters ──header auth──► n8n /webhook/meter-readings ──signed──► /v1 API
```

## Workflowها

| فایل | Trigger | کار |
|---|---|---|
| `01-event-router.json` | Webhook `POST /webhook/zarin-events` | بررسی امضا، سپس Route بر اساس `type`. رویدادِ هتلی که در `ZARIN_HOTEL_IDS` نیست (مثلاً هتل آزمایشی روی همان بک‌اند) دور ریخته می‌شود: <br>• `alert.raised` → گروه مدیریت در بله، و اگر critical باشد پیامک به مدیر کشیک <br>• `maintenance.ticket.created` با اولویت high/critical → گروه تأسیسات در بله <br>• `inventory.lowStock` → ایمیل درخواست خرید به تدارکات <br>• `energy.anomaly` → گروه انرژی در بله |
| `02-daily-management-briefing.json` | هر روز ساعت ۰۷:۱۵ (به وقت تهران) | `GET /v1/hotels/{id}/summary?narrative=fa`: شاخص‌های دیروز، هشدارهای باز، پیشنهادهای AI و یک خلاصهٔ مدیریتی فارسی که LLM می‌نویسد. خروجی به‌صورت ایمیل RTL برای GM و مالک و پیام بله فرستاده می‌شود. |
| `03-maintenance-sla-escalation.json` | هر ۳۰ دقیقه | `GET /maintenance/overdue`. تیکت‌هایی که بیش از ۶۰ دقیقه از SLA عقب‌اند ← اعلان درون‌برنامه‌ای و Push به مدیر تأسیسات، GM و مدیر عملیات. برای موارد critical پیامک هم ارسال می‌شود. |
| `04-smart-meter-ingestion.json` | Webhook `POST /webhook/meter-readings` (Header Auth) | قرائت روزانهٔ کنتورهای هوشمند را نرمال می‌کند و به `POST /energy/readings` می‌فرستد. سند ذخیره‌شده دقیقاً همان شکل ورود دستی را دارد، پس تحلیل‌ها و داشبوردها تغییری نمی‌کنند. بدنه: `{"readings":[{"hotelId","meterId","type":"electricity\|water\|gas","day":"yyyy-MM-dd","value"}]}`. برای هر هتل، روز و نوع مصرف **یک مجموع روزانه** ذخیره می‌شود و ارسال دوباره جای مقدار قبلی را می‌گیرد. اگر چند کنتور از یک نوع دارید، گیت‌وی باید مجموع آن‌ها را بفرستد. |

## کانال‌ها: یکی‌یکی فعال کنید

هر نود ارسال (بله، پیامک، ایمیل) پشت یک نود IF با نام «… configured?» قرار دارد. این نود فقط وقتی متغیرهای همان کانال پر باشند اجازهٔ عبور می‌دهد. پس می‌توانید workflowها را پیش از راه‌اندازی هر کانالی فعال کنید و کانال‌ها را بعداً یکی‌یکی اضافه کنید. وقتی متغیرهای یک کانال خالی است، همان شاخه رد می‌شود و اجرا موفق تمام می‌شود (با `npm run e2e:no-channels` تست شده است).

| کانال | متغیرها | نودهای گیت | کار اضافه |
|---|---|---|---|
| بله | `BALE_BOT_TOKEN` به‌علاوهٔ `BALE_MANAGEMENT_CHAT_ID`، `BALE_MAINTENANCE_CHAT_ID` یا `BALE_ENERGY_CHAT_ID` | `Bale configured? · management / maintenance / energy` در ۰۱، و `· management` در ۰۲ | — |
| پیامک (کاوه‌نگار) | `KAVENEGAR_API_KEY` به‌علاوهٔ `ONCALL_MANAGER_MOBILE` یا `MAINTENANCE_MANAGER_MOBILE` | `SMS configured? · on-call` در ۰۱، و `· maintenance` در ۰۳ | — |
| ایمیل | `ZARIN_MAIL_FROM` به‌علاوهٔ `PROCUREMENT_EMAIL` یا `ZARIN_REPORT_RECIPIENTS` | `E-mail configured? · procurement` در ۰۱، و `· GM & owner` در ۰۲ | Credential SMTP و روشن کردن نود ایمیل (پایین) |

هر گروه بله جداگانه بررسی می‌شود. مثلاً اگر فقط `BALE_ENERGY_CHAT_ID` خالی باشد، فقط پیام انرژی رد می‌شود.

**روشن کردن ایمیل.** نودهای *Purchase request e-mail* (۰۱) و *E-mail GM & owner* (۰۲) در فایل‌ها خاموش (Deactivated) هستند. دلیلش این است که n8n workflowی را که نود ایمیلش Credential ندارد منتشر نمی‌کند و خطای «1 node has issues» می‌دهد. وقتی SMTP آماده شد:
1. در Credentials یک Credential از نوع SMTP بسازید (مشخصات در پایین).
2. در هر دو workflow روی نود ایمیل دوبار کلیک کنید و این Credential را انتخاب کنید.
3. نود را روشن کنید: آن را انتخاب کنید و کلید `D` را بزنید، یا راست‌کلیک ← Activate. سپس workflow را Save کنید و اگر قبلاً منتشر شده، دوباره Publish کنید.

`import-workflows.mjs` در به‌روزرسانی‌های بعدی، Credential و روشن بودن این نودها را نگه می‌دارد.

**شناسهٔ چت بله.** مقدار `BALE_*_CHAT_ID` باید **شناسهٔ عددی** چت باشد، نه نام کاربری یا لینک گروه (`@…`):
1. ربات را عضو گروه کنید. برای کانال، ربات باید ادمین باشد.
2. یک پیام در گروه بفرستید.
3. در مرورگر سیستم خودتان `https://tapi.bale.ai/bot<TOKEN>/getUpdates` را باز کنید. مقدار `message.chat.id` همان شناسه است. این عدد برای گروه‌ها ممکن است منفی باشد؛ آن را با همان علامت وارد کنید.

**SMTP.**
- **Gmail:** رمز معمولی حساب کار نمی‌کند. باید تأیید دومرحله‌ای (2-Step Verification) روشن باشد و یک **App Password** بسازید (Google Account ← Security ← App passwords). تنظیمات: Host `smtp.gmail.com`، Port `465` با گزینهٔ SSL/TLS روشن. توجه کنید که n8n روی سرور داخل ایران است و اتصال به SMTP گوگل از ایران ممکن است مسدود یا ناپایدار باشد.
- **جایگزین پیشنهادی: سرویس ایمیل لیارا.** در پنل لیارا یک سرویس ایمیل بسازید، دامنهٔ فرستنده را طبق راهنمای همان بخش تأیید کنید، و Host، Port، نام کاربری و رمز SMTP را از همان صفحه بردارید. `ZARIN_MAIL_FROM` باید آدرسی روی همان دامنه باشد.
- هر سرویس SMTP داخلی دیگری هم کار می‌کند.

## قرارداد رویدادها (Backend → n8n)

همهٔ رویدادها به یک Webhook فرستاده می‌شوند:

```json
{
  "id": "alert.raised:zarin-grand-tehran:1759650000000",
  "type": "alert.raised",
  "hotelId": "zarin-grand-tehran",
  "occurredAt": "2026-10-05T06:30:00.000Z",
  "data": { "severity": "critical", "title": "…", "message": "…", "audienceRoles": ["…"] }
}
```

| `type` | فیلدهای `data` |
|---|---|
| `alert.raised` | `alertId, type, severity, title, message, audienceRoles, …` |
| `maintenance.ticket.created` | `ticketId, title, category, priority, location, reportedByName, slaDueAt` |
| `maintenance.ticket.updated` | `ticketId, from, to, assigneeName` |
| `energy.anomaly` | `day, type, consumption, baseline, deviation` |
| `inventory.lowStock` | `itemId, name, sku, quantity, reorderLevel, reorderQuantity, supplier` |
| `insight.created` | `insightId, title, priority` |
| `user.created` | `uid, role` |

ارسال رویداد به‌صورت *fire-and-forget* است. اگر n8n در دسترس نباشد، عملیات اصلی (مثل ثبت تیکت) شکست نمی‌خورد. در PocketBase، رویدادها در صف `outbox` می‌مانند و هر دقیقه دوباره ارسال می‌شوند (حداکثر ۸ بار). هر ارسال پیش از فرستادن، رویداد را برای خودش رزرو می‌کند، پس اگر cron و `POST /v1/outbox/flush` هم‌زمان اجرا شوند، رویداد تکراری ارسال نمی‌شود. هشدار و اعلان درون‌برنامه‌ای همیشه توسط خود بک‌اند ساخته می‌شوند و n8n فقط کانال‌های **بیرونی** را اضافه می‌کند.

## امنیت: امضای HMAC در هر دو جهت

```
x-zarin-timestamp: <unix seconds>
x-zarin-signature: hex( HMAC_SHA256(INTEGRATION_SECRET, "<timestamp>.<rawBody>") )
```

- درخواستی که بیش از ۵ دقیقه از زمانش گذشته باشد رد می‌شود (Replay protection).
- مقایسهٔ امضا با `timingSafeEqual` انجام می‌شود.
- Webhook کنتورها کلید جداگانه دارد (Header Auth). گیت‌وی IoT هیچ‌وقت سکرت پلتفرم را نمی‌بیند.

## راه‌اندازی

1. **اجرای n8n**
   ```bash
   cd n8n
   cp .env.example .env        # مقادیر را پر کنید
   docker compose up -d
   ```
   دو تنظیم لازم است و در `docker-compose.yml` آمده‌اند: `NODE_FUNCTION_ALLOW_BUILTIN=crypto` برای امضا در Code nodeها، و `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` برای خواندن `$env`.

2. **Import کردن workflowها.** از Editor → *Import from File*، یا:
   ```bash
   docker compose exec n8n n8n import:workflow --separate --input=/workflows
   ```

3. **Credentials** (پس از import، روی نودهای مربوط انتخاب کنید):
   - **Header Auth**: نود *Meter gateway webhook*، مثلاً `X-Meter-Key: <random>`. همین کلید را به گیت‌وی کنتور بدهید. n8n بدون این Credential اجازهٔ فعال کردن workflow ۰۴ را نمی‌دهد.
   - **SMTP** (اختیاری): نودهای *E-mail GM & owner* و *Purchase request e-mail*. این نودها خاموش import می‌شوند و پس از انتخاب Credential باید روشن شوند (بخش «کانال‌ها» در بالا).

4. **اتصال بک‌اند به n8n**

   **PocketBase (پیشنهادی):** در `pocketbase/deploy/.env` این دو را تنظیم کنید:
   - `ZH_INTEGRATION_SECRET` (همان `ZARIN_INTEGRATION_SECRET`)
   - `ZH_N8N_WEBHOOK_URL=https://<n8n>/webhook/zarin-events`

   در `n8n/.env` هم `ZARIN_API_BASE=https://<دامنهٔ سرور PocketBase>` را بگذارید. شناسهٔ هتل‌ها را خروجی `npm run create-hotel` نشان می‌دهد.

   **Firebase:**
   ```bash
   cd firebase/functions
   firebase functions:secrets:set INTEGRATION_SECRET      # همان ZARIN_INTEGRATION_SECRET
   echo 'N8N_WEBHOOK_URL=https://<n8n>/webhook/zarin-events' >> .env.<project-id>
   npm run deploy
   ```

5. **Activate.** هر چهار workflow را فعال کنید. آدرس `…/webhook/…` (production) فقط وقتی workflow فعال است پاسخ می‌دهد.

## n8n روی لیارا

آدرس n8n: `https://zarin-hoshmand-jexcz8u8pp.liara.run`. هر چهار workflow در این نمونه import شده‌اند و فعلاً غیرفعال‌اند.

مراحل باقی‌مانده به ترتیب اجرا، همراه با جدول کامل متغیرهای محیطی، Credentialها، ترتیب فعال‌سازی، آزمون نهایی و عیب‌یابی، در **[راهنمای راه‌اندازی لیارا](../docs/09-liara-runbook.md)** آمده است.

**به‌روزرسانی workflowها:** وقتی فایلی در `workflows/` تغییر کند، این دستور workflowها را با نام پیدا و در همان جا به‌روز می‌کند:
- نسخهٔ تکراری ساخته نمی‌شود.
- Credentialهایی که در Editor انتخاب کرده‌اید، و روشن یا خاموش بودن نودهایی که Credential دارند، حفظ می‌شوند.
- workflowهای فعال با نسخهٔ جدید دوباره منتشر می‌شوند.

این دستور به Node 18 یا جدیدتر و یک API key نیاز دارد (Settings ← n8n API). کلید را در پیام یا فایل ننویسید؛ دستور آن را می‌پرسد:

```zsh
# macOS (zsh)، در پوشهٔ مخزن
export N8N_URL=https://zarin-hoshmand-jexcz8u8pp.liara.run
read -s "N8N_API_KEY?n8n API key: "; echo; export N8N_API_KEY
node n8n/scripts/import-workflows.mjs
unset N8N_API_KEY
```

در bash به‌جای خط `read` از `read -rsp "n8n API key: " N8N_API_KEY; echo; export N8N_API_KEY` استفاده کنید. در Windows PowerShell 7:
```powershell
$env:N8N_URL="https://zarin-hoshmand-jexcz8u8pp.liara.run"; $env:N8N_API_KEY = Read-Host -MaskInput "n8n API key"
node n8n/scripts/import-workflows.mjs; Remove-Item Env:N8N_API_KEY
```

اگر کلید را فقط برای همین کار ساخته‌اید، پس از اجرا آن را در n8n حذف کنید.

**بدون API key:** روش Console مرورگر ([`scripts/console-update.js`](scripts/console-update.js)) در [مرحلهٔ ۴ راهنمای لیارا](../docs/09-liara-runbook.md#روش-جایگزین-بدون-api-key) آمده است.

**روش دستی:** workflow را در Editor باز کنید، از منوی ⋯ گزینهٔ *Import from File* را بزنید، فایل JSON را انتخاب کنید و Save کنید. این روش کل بوم را جایگزین می‌کند، پس Credentialها را دوباره انتخاب کنید و نودهای ایمیلی را که روشن کرده بودید دوباره روشن کنید.

> فایل‌های workflow عمداً tag ندارند. n8n CLI (`import:workflow --separate`) وقتی چند فایل یک tag تازهٔ مشترک داشته باشند، با خطای `UNIQUE constraint failed: tag_entity.name` متوقف می‌شود. در صورت نیاز، tagها را پس از import در Editor اضافه کنید.

## تست دستی

```bash
SECRET=local-dev-secret
BODY='{"id":"t1","type":"alert.raised","hotelId":"zarin-grand-tehran","occurredAt":"2026-10-05T06:30:00Z","data":{"severity":"critical","title":"تست","message":"پیام تست"}}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -sS -X POST "$N8N/webhook-test/zarin-events" \
  -H 'content-type: application/json' -H "x-zarin-timestamp: $TS" -H "x-zarin-signature: $SIG" \
  --data "$BODY"
```

> نود *Verify signature* بدنه را دوباره با `JSON.stringify` سریال می‌کند. این کار برای رویدادهای بک‌اند، که خودشان با `JSON.stringify` ساخته می‌شوند، دقیقاً همان رشته را تولید می‌کند. برای تست دستی، بدنه را فشرده (بدون فاصلهٔ اضافه) بفرستید.

## تست انتها‌به‌انتها (اختیاری)

`test/e2e.mjs` هر چهار workflow را روی یک n8n واقعی (نسخهٔ 2.35.7) و یک PocketBase محلیِ seedشده اجرا می‌کند. بله، کاوه‌نگار و SMTP با سرویس‌های ساختگی محلی جایگزین می‌شوند، پس هیچ پیامی واقعاً ارسال نمی‌شود. این موارد بررسی می‌شوند:

- مسیرهای ۰۱: هشدار به بله، پیامک critical، ایمیل خرید، رد شدن رویداد جعلی، و دور ریختن رویداد هتلی که در `ZARIN_HOTEL_IDS` نیست.
- گزارش صبحگاهی RTL در ۰۲، Escalation در ۰۳، و Header Auth و ثبت قرائت در ۰۴.
- نبودِ ارسال تکراری.
- اجرای دوبارهٔ `import-workflows.mjs` بدون از دست رفتن Credentialها.
- هیچ اجرای ناموفقی در n8n ثبت نشود.
- در حالت بدون کانال (همان وضعیت لیارا پیش از تنظیم بله، پیامک و SMTP): همهٔ اجراها موفق باشند و هیچ پیامی ارسال نشود.

```bash
(cd pocketbase && npm install && ./scripts/get-pocketbase.sh)
cd n8n/test && npm install      # Node 22.22+، نصب n8n حدود ۱ گیگابایت
npm run e2e                     # همهٔ کانال‌ها تنظیم شده (۲۱ بررسی)
npm run e2e:no-channels         # هیچ کانالی تنظیم نشده: همهٔ اجراها باید موفق باشند (۱۶ بررسی)
```

**روی نسخهٔ لیارا (Docker).** با `N8N_IMAGE`، n8n از ایمیج Docker همان نسخه اجرا می‌شود، نه از بستهٔ نصب‌شده. هر دو حالت روی 2.26.2 (همان نسخهٔ لیارا) سبز است:
```bash
N8N_IMAGE=n8nio/n8n:2.26.2 npm run e2e
N8N_IMAGE=n8nio/n8n:2.26.2 npm run e2e:no-channels
```

**بررسی Editor در مرورگر** (`npm run browser-check`، به Docker و Chromium مربوط به Playwright نیاز دارد؛ ۹ بررسی):
- کدام حالت‌ها در Editor قابل Publish هستند: فایل‌های فعلی بله، ولی نود ایمیلِ روشن بدون SMTP و ۰۴ بدون Header Auth نه.
- روش جایگزین Console ([`scripts/console-update.js`](scripts/console-update.js)) اولین نسخهٔ import‌شده روی لیارا را به‌روز می‌کند و Credential SMTP آن را نگه می‌دارد.
- درخواست بدون هدر `browser-id` با 401 رد می‌شود و کاربر از n8n خارج می‌شود.

پس از هر تغییر در workflowها یا API نسخهٔ v1 آن را اجرا کنید. پورت‌های ۵۶۸۸، ۵۶۸۹ و ۲۵۲۶ باید آزاد باشند.

## افزودن workflow جدید

1. اگر رویداد تازه‌ای لازم است، آن را در `firebase/functions/src/lib/n8n.ts` (`IntegrationEventType`) اضافه کنید و از trigger مربوط `emitEvent` را صدا بزنید.
2. در `01-event-router` یک خروجی به Switch اضافه کنید، یا یک workflow جداگانه با Webhook خودش بسازید.
3. برای نوشتن در پلتفرم فقط از API نسخهٔ `/v1` (امضاشده) استفاده کنید. n8n هیچ‌وقت مستقیم به Firestore دسترسی ندارد.

## ملاحظات منطقه‌ای

- برای پیام‌رسانی، **بله** (`tapi.bale.ai`) و **پیامک** (کاوه‌نگار) انتخاب شده‌اند، چون در ایران پایدارند. جایگزینی آن‌ها با ایتا، سروش یا سامانهٔ پیامکی دیگر فقط تغییر همان نود HTTP است.
- n8n را روی سرور داخل ایران مستقر کنید. این همان سروری است که در فاز بعد بک‌اند اختصاصی روی آن مستقر می‌شود (رجوع کنید به `docs/08-roadmap.md`).
