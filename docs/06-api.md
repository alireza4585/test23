# ۹. طراحی API

API سه سطح دارد. هر سه از یک ماتریس RBAC و یک لایهٔ domain استفاده می‌کنند:

| سطح | مصرف‌کننده | احراز هویت | پروتکل |
|---|---|---|---|
| **Firestore مستقیم** (CRUD عملیاتی) | اپ Flutter | Firebase ID token و Security Rules | SDK، real-time |
| **Callable Functions** (عملیات حساس) | اپ Flutter | Firebase ID token و `requireCaller → requireHotel → requirePermission` | HTTPS callable |
| **Integration API v1** (REST) | n8n، گیت‌وی IoT، شرکای آینده (PMS) | امضای HMAC-SHA256 | JSON over HTTPS |

> هر عملیاتی که فقط باید روی سرور انجام شود، مثل ساختن کاربر، تغییر claim، فراخوانی LLM یا ارسال اعلان، **هرگز** از کلاینت مستقیم در Firestore نوشته نمی‌شود.

## Callable Functions (region: `europe-west3`)

| نام | ورودی | مجوز | خروجی | خطاها |
|---|---|---|---|---|
| `adminCreateUser` | `{hotelId, nationalId, fullName, phone?, role, temporaryPassword}` | `users.manage` و `canAssign(caller, role)` | `{uid}` | `invalid_national_id`، `national_id_exists`، `weak_password`، `role_not_assignable` |
| `adminSetUserStatus` | `{hotelId, uid, status: active｜suspended｜disabled}` | `users.manage`. روی خودش یا نقش‌های بالاتر مجاز نیست | `{ok}` | `permission-denied` |
| `adminResetPassword` | `{hotelId, uid, temporaryPassword}` | `users.manage` | `{ok}`. نشست‌ها باطل و `mustChangePassword=true` | |
| `adminUpdateRole` | `{hotelId, uid, role}` | `users.manage` و توانایی assign هر دو نقش (قبلی و جدید) | `{ok}`. claim جدید و ابطال توکن‌ها | `role_not_assignable` |
| `authRegisterSession` | `{deviceId, platform, model, osVersion, appVersion, pushToken?}` | کاربر واردشده | `{ok}` | |
| `authRevokeSessions` | `{uid?}` (پیش‌فرض: خود کاربر) | خود کاربر یا superAdmin | `{revoked: n}` | |
| `aiAssistant` | `{hotelId, question (2..1000), locale: fa｜en, history[≤12]}` | `ai.assistant.use`، سقف ۳۰ درخواست در ساعت | `{answer, dataPoints[]}` | `resource-exhausted`، `unavailable` |

رمز موقت باید حداقل ۸ کاراکتر باشد و دست‌کم یک حرف و یک رقم داشته باشد. همهٔ ورودی‌ها با Zod اعتبارسنجی می‌شوند و همهٔ عملیات مدیریتی در `auditLogs` ثبت می‌شوند.

## Integration API v1 (REST)

`https://europe-west3-<project>.cloudfunctions.net/api/v1/...`

### امضا

```
x-zarin-timestamp: 1759650000
x-zarin-signature: hex(HMAC_SHA256(INTEGRATION_SECRET, "1759650000." + rawBody))
```

- اختلاف زمانی حداکثر ۵ دقیقه (Replay protection). مقایسه با `timingSafeEqual`.
- برای `GET` بدنهٔ خالی امضا می‌شود (`"<ts>."`).
- پاسخ‌ها: `401 invalid_signature`، `404 not_found | hotel_not_found`، `400 invalid_body (+issues)`، `500 internal`.

### Endpointها

| Method | Path | توضیح |
|---|---|---|
| `GET` | `/v1/health` | بدون امضا: `{ok, service, version}` |
| `GET` | `/v1/hotels/{hotelId}/summary?day=yyyy-MM-dd&narrative=fa｜en` | KPIهای روز (پیش‌فرض: دیروز)، هشدارهای باز، insightهای فعال و `narrative` اختیاری (خلاصهٔ مدیریتی LLM) |
| `GET` | `/v1/hotels/{hotelId}/maintenance/overdue` | تیکت‌های فعالی که از SLA گذشته‌اند، همراه `overdueMinutes` |
| `POST` | `/v1/hotels/{hotelId}/notifications` | اعلان درون‌برنامه‌ای و Push به نقش‌ها یا کاربران |
| `POST` | `/v1/hotels/{hotelId}/insights` | ثبت insight خارجی (مثلاً از مدل پیش‌بینی) با id `llm_<id>` |
| `POST` | `/v1/hotels/{hotelId}/energy/readings` | ورود دادهٔ کنتور هوشمند یا IoT |
| `POST` | `/v1/hotels/{hotelId}/insights/run` | اجرای فوری موتور قواعد |

**نمونه: `GET /summary?narrative=fa`**

```json
{
  "hotelId": "zarin-grand-tehran",
  "hotel": "هتل بزرگ زرین",
  "day": "2026-10-04",
  "metrics": {
    "occupancyRate": 78, "adr": 86200000, "revpar": 67236000,
    "energy": { "electricity": 3010, "water": 41.2, "gas": 302 },
    "electricityVsBaselinePct": 22.4,
    "maintenance": { "open": 7, "overdue": 2, "critical": 1, "avgResolutionHours": 5.3 },
    "housekeeping": { "tasks": 31, "done": 29, "avgCheckoutCleanMinutes": 33.5 },
    "inventory": { "lowStock": 3, "outOfStock": 0, "stockValue": 812000000 },
    "rooms": { "outOfOrder": 2, "total": 60 }
  },
  "alerts":   [{ "id": "energy_electricity", "severity": "warning", "title": "…", "message": "…" }],
  "insights": [{ "id": "energyIntensity_electricity", "title": "…", "recommendation": "…", "estimatedMonthlySaving": 42000000 }],
  "narrative": "خلاصه: اشغال ۷۸٪ …"
}
```

**`POST /notifications`**

```json
{
  "roles": ["maintenanceManager", "generalManager"],
  "userIds": [],
  "title": "۲ خرابی خارج از SLA",
  "body": "• کولر اتاق ۴۰۵ — ۳ ساعت تأخیر",
  "severity": "critical",
  "category": "maintenance",
  "route": "/maintenance"
}
→ { "recipients": 4 }
```

**`POST /energy/readings`**

```json
{ "type": "electricity", "day": "2026-10-05", "consumption": 2875.4, "meterId": "MTR-01", "source": "smartMeter" }
→ { "id": "2026-10-05_electricity" }
```

این endpoint idempotent است (کلید روز و نوع). سند ذخیره‌شده همان شکل ورود دستی را دارد و trigger تشخیص ناهنجاری روی آن هم اجرا می‌شود.

## رویدادهای خروجی (Backend → n8n)

`POST N8N_WEBHOOK_URL` با همان امضا. بدنه: `{id, type, hotelId, occurredAt, data}`.

نوع‌ها: `alert.raised`، `maintenance.ticket.created`، `maintenance.ticket.updated`، `energy.anomaly`، `inventory.lowStock`، `insight.created`، `user.created`.

فیلدهای هر نوع در [`n8n/README.md`](../n8n/README.md) آمده است.

## Triggers و Scheduled (داخلی)

| Function | رویداد | کار |
|---|---|---|
| `onTicketCreated` | ایجاد تیکت | هشدار (critical/high) یا اعلان به مدیر تعمیرات، خارج کردن اتاق خالی از سرویس در خرابی بحرانی، رویداد n8n |
| `onTicketUpdated` | assign و تغییر وضعیت | اعلان به تکنسین هنگام ارجاع، اعلان به گزارش‌دهنده هنگام رفع، بستن هشدارهای تیکت و SLA، رویداد n8n |
| `onEnergyReadingWritten` | قرائت انرژی | مقایسه با baseline، هشدار `energySpike` و رویداد `energy.anomaly` |
| `onInventoryItemUpdated` | تغییر موجودی | رسیدن به نقطهٔ سفارش ← هشدار `lowStock` و رویداد `inventory.lowStock` (dedupe) |
| `onTaskWritten` | پایان تسک | ثبت `durationMinutes` |
| `auditHotelWrites` | هر نوشتن زیر `hotels/{h}` | Audit log با actor و diff |
| `analyticsDailyRollup` | ۰۰:۲۰ تهران | `dailyMetrics/{yesterday}` و هشدارهای SLA |
| `aiGenerateInsights` | ۰۶:۴۰ تهران | موتور قواعد ← `aiInsights` و اعلان |

## نسخه‌بندی و مسیر آینده

- مسیر `/v1` قرارداد عمومی است. تغییر ناسازگار یعنی `/v2`، و هر دو نسخه هم‌زمان اجرا می‌شوند.
- بک‌اند اختصاصی (NestJS یا Go، با PostgreSQL) **همین قرارداد v1** را پیاده می‌کند و برای اپ endpointهای REST معادل callableها اضافه می‌شوند (`POST /v1/hotels/{h}/users`، `POST /v1/assistant`). احراز هویت آن JWT صادرشده از سرویس Auth داخلی است.
- مستند OpenAPI از همین schemaهای Zod قابل تولید است (`zod-to-openapi`). این کار در Roadmap فاز ۲ است.
