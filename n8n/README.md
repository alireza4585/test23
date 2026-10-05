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
| `01-event-router.json` | Webhook `POST /webhook/zarin-events` | بررسی امضا، سپس Route بر اساس `type`: <br>• `alert.raised` → گروه مدیریت در بله، و اگر critical باشد پیامک به مدیر کشیک <br>• `maintenance.ticket.created` با اولویت high/critical → گروه تأسیسات در بله <br>• `inventory.lowStock` → ایمیل درخواست خرید به تدارکات <br>• `energy.anomaly` → گروه انرژی در بله |
| `02-daily-management-briefing.json` | هر روز ساعت ۰۷:۱۵ (به وقت تهران) | `GET /v1/hotels/{id}/summary?narrative=fa`: شاخص‌های دیروز، هشدارهای باز، پیشنهادهای AI و یک خلاصهٔ مدیریتی فارسی که LLM می‌نویسد. خروجی به‌صورت ایمیل RTL برای GM و مالک و پیام بله فرستاده می‌شود. |
| `03-maintenance-sla-escalation.json` | هر ۳۰ دقیقه | `GET /maintenance/overdue`. تیکت‌هایی که بیش از ۶۰ دقیقه از SLA عقب‌اند ← اعلان درون‌برنامه‌ای و Push به مدیر تأسیسات، GM و مدیر عملیات. برای موارد critical پیامک هم ارسال می‌شود. |
| `04-smart-meter-ingestion.json` | Webhook `POST /webhook/meter-readings` (Header Auth) | قرائت روزانهٔ کنتورهای هوشمند را نرمال می‌کند و به `POST /energy/readings` می‌فرستد. سند ذخیره‌شده دقیقاً همان شکل ورود دستی را دارد، پس تحلیل‌ها و داشبوردها تغییری نمی‌کنند. |

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

ارسال رویداد به‌صورت *fire-and-forget* است. اگر n8n در دسترس نباشد، عملیات اصلی (مثل ثبت تیکت) شکست نمی‌خورد. هشدار و اعلان درون‌برنامه‌ای همیشه توسط خود بک‌اند ساخته می‌شوند و n8n فقط کانال‌های **بیرونی** را اضافه می‌کند.

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
   - **SMTP**: نودهای *E-mail GM & owner* و *Purchase request e-mail*.
   - **Header Auth**: نود *Meter gateway webhook*، مثلاً `X-Meter-Key: <random>`. همین کلید را به گیت‌وی کنتور بدهید.

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

آدرس n8n: `https://zarin-hoshmand-jexcz8u8pp.liara.run`

1. **متغیرهای محیطی:** در پنل لیارا، در برنامهٔ n8n، بخش «متغیرهای محیطی» این‌ها را اضافه کنید و برنامه را restart کنید:
   ```
   NODE_FUNCTION_ALLOW_BUILTIN=crypto
   N8N_BLOCK_ENV_ACCESS_IN_NODE=false
   GENERIC_TIMEZONE=Asia/Tehran
   ZARIN_API_BASE=https://<آدرس برنامهٔ PocketBase>.liara.run
   ZARIN_INTEGRATION_SECRET=<همان مقدار ZH_INTEGRATION_SECRET در برنامهٔ PocketBase>
   ZARIN_HOTEL_IDS=<شناسهٔ هتل که create-hotel چاپ می‌کند>
   ```
   سایر متغیرها (`BALE_*`، `KAVENEGAR_API_KEY`، ایمیل) را هم از `.env.example` اضافه کنید.
2. **Import:** فایل‌های `n8n/workflows/*.json` را از GitHub دانلود کنید و در n8n از مسیر Workflows → ⋯ → Import from File وارد کنید. Credentialهای SMTP و Header Auth را روی نودهای مربوط انتخاب کنید (رجوع کنید به مرحلهٔ ۳ بالا).
3. **اتصال PocketBase به n8n:** در برنامهٔ PocketBase روی لیارا این متغیر را بگذارید:
   ```
   ZH_N8N_WEBHOOK_URL=https://zarin-hoshmand-jexcz8u8pp.liara.run/webhook/zarin-events
   ```
4. **فعال‌سازی:** هر چهار workflow را Active کنید. برای آزمایش اتصال، از n8n یک درخواست امضاشده به `GET {ZARIN_API_BASE}/v1/hotels/{id}/summary` بزنید (workflow شمارهٔ ۲ را دستی اجرا کنید).

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

## افزودن workflow جدید

1. اگر رویداد تازه‌ای لازم است، آن را در `firebase/functions/src/lib/n8n.ts` (`IntegrationEventType`) اضافه کنید و از trigger مربوط `emitEvent` را صدا بزنید.
2. در `01-event-router` یک خروجی به Switch اضافه کنید، یا یک workflow جداگانه با Webhook خودش بسازید.
3. برای نوشتن در پلتفرم فقط از API نسخهٔ `/v1` (امضاشده) استفاده کنید. n8n هیچ‌وقت مستقیم به Firestore دسترسی ندارد.

## ملاحظات منطقه‌ای

- برای پیام‌رسانی، **بله** (`tapi.bale.ai`) و **پیامک** (کاوه‌نگار) انتخاب شده‌اند، چون در ایران پایدارند. جایگزینی آن‌ها با ایتا، سروش یا سامانهٔ پیامکی دیگر فقط تغییر همان نود HTTP است.
- n8n را روی سرور داخل ایران مستقر کنید. این همان سروری است که در فاز بعد بک‌اند اختصاصی روی آن مستقر می‌شود (رجوع کنید به `docs/08-roadmap.md`).
