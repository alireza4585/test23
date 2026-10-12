# ۱۶. معماری AI زرین هوشمند، فاز ۰ (پایه و امنیت)

این سند وضعیت پیاده‌شدهٔ فاز ۰ از [برنامهٔ AI](15-ai-plan.md) را شرح می‌دهد:

- بستن نقص‌های امنیتی دستیار؛
- امضای scoped برای integration API؛
- پرچم‌های قابلیت به تفکیک هتل؛
- سرویس `ai-worker` با LLM gateway؛
- مجموعهٔ ارزیابی فارسی.

بخش آخر runbook استقرار است و اجرای آن با شماست.

## ۱. نمای کلی

```text
[Flutter app] ── REST + realtime ──> [PocketBase: منبع حقیقت، مجوزها، دستیار امن، aiBudgets، audit]
     PocketBase <── v1 امضاشده (shared secret) ── [n8n: زمان‌بندی، اعلان؛ بدون منطق اصلی]
     PocketBase <── v1 امضاشده (scoped key + nonce) ── [ai-worker (Python): jobها، LLM gateway، eval]
[ai-worker] ──> [LLM gateway: provider اصلی ← fallback، timeout، بودجهٔ هتل، حذف داده هویتی، cost log] ──> [Liara AI (OpenAI-compatible)]
[PocketBase ai.js] ──> همان endpoint سازگار با OpenAI (مستقیم، با همان قواعد امنیتی)
```

- **PocketBase** همچنان تنها جایی است که مجوز بررسی می‌شود.
- **worker** فقط از طریق endpointهای امضاشدهٔ `/v1/hotels/{id}/…` می‌خواند و می‌نویسد.
- اگر worker یا LLM در دسترس نباشد، قوانین قطعی و پاسخ قاعده‌محور سر جایشان می‌مانند.

## ۲. دستیار: چه چیزی بسته شد

فایل: `pocketbase/pb_hooks/lib/ai.js`. همهٔ این موارد بدون پرچم و همیشه فعال‌اند.

| نقص | رفع | آزمون |
|---|---|---|
| نشت درآمد به نقش‌های بدون `finance.view` | context بر اساس مجوز ساخته می‌شود (جدول زیر). پاسخ قاعده‌محور و `dataPoints` هم همین فیلتر را دارند. فهرست `restricted` به مدل می‌گوید چه چیزی را نمی‌بیند | `ai-security.test.mjs` › permission-filtered context (۴ آزمون) |
| تاریخچهٔ جعلی از گوشی | `history` گوشی نادیده گرفته می‌شود. تاریخچه از `aiConversations` (فیلد تازهٔ `thread`) همان کاربر و همان هتل، حداکثر ۶ نوبت و ۲۴ ساعت، خوانده می‌شود. thread کاربر دیگر پذیرفته نمی‌شود | › history comes from the server (۲) |
| prompt injection از متن آزاد | این متن‌ها پاک‌سازی می‌شوند: عنوان تیکت، محل، نام کالا، عنوان و خلاصهٔ insight، و خود سؤال. پاک‌سازی شامل این‌هاست: حذف کاراکترهای کنترلی، bidi و `<>` و backtick؛ محدودیت طول؛ escape کردن `<` و `>` در JSON تا داده نتواند `</hotel_data>` را ببندد؛ هشدار صریح در system prompt. روی ورودی `narrate()` هم انجام می‌شود | › untrusted free text (۳) |
| ارسال دادهٔ هویتی | شمارهٔ موبایل و ثابت به `[phone]` و کد ملی ۱۰ رقمی به `[id]` تبدیل می‌شود (ارقام فارسی هم پوشش داده می‌شوند). نام کارکنان هتل به `[P1]`، `[P2]` و … تبدیل و در پاسخ نهایی برگردانده می‌شود | همان |
| عدد ساختگی | هر عدد پاسخ LLM باید در context باشد. معیار تطبیق: گرد کردن، درصد، یا هزار/میلیون/میلیارد. عددهای صحیح تا ۱۲ همیشه مجازند. اگر نبود، یک بار دوباره تولید می‌شود و بعد پاسخ قاعده‌محور برمی‌گردد (`fallback_unverified`). اگر روایت صبحگاهی اعتبارسنجی را رد کند، `null` برمی‌گردد و n8n متن قالبی می‌فرستد | › numbers, cost and budget؛ › Morning narrative |
| هزینه | `max_tokens` برای دستیار ۱۰۲۴ و برای روایت ۸۰۰ است. مدل پیش‌فرض در کد وجود ندارد (`ZH_AI_MODEL` الزامی است). timeout ۴۵ ثانیه است. بودجهٔ ماهانهٔ توکن به تفکیک هتل در `aiBudgets` نگه داشته می‌شود؛ پس از اتمام بودجه، پاسخ قاعده‌محور برمی‌گردد | همان |
| نگهداری گفتگو | cron `zarin_ai_retention` (روزانه) گفتگوهای قدیمی‌تر از `ZH_AI_RETENTION_DAYS` (پیش‌فرض ۹۰ روز) را حذف می‌کند. endpoint دستی آن `POST /v1/maintenance/purge` است | › Conversation retention |

**بخش‌های context و مجوز لازم برای هر کدام:**

| بخش context | مجوز لازم |
|---|---|
| اشغال | یکی از این‌ها: `dashboard.executive`، `dashboard.operations` یا `finance.view` |
| ADR، RevPAR و درآمد | `finance.view` |
| انرژی، خط مبنا و تعرفه | `energy.view` |
| وضعیت اتاق‌ها | `rooms.view` |
| تیکت‌ها | `maintenance.viewAll` |
| موجودی | `inventory.view` |
| insightها | `ai.insights.view` و مجوز همان دسته. مثلاً insight دستهٔ revenue فقط با `finance.view` نمایش داده می‌شود |

**یافتهٔ باز (رفع نشده، تصمیم با شما):** دادهٔ مالی هنوز از دو مسیر دیگر در دسترس است:

- **REST API:** قانون `listRule` در collection `dailyOperations` به این نقش‌ها اجازهٔ خواندن می‌دهد: `energy.view`، `dashboard.operations` و `operations.recordDaily`. این collection فیلدهای `roomRevenue`، `fnbRevenue` و `otherRevenue` را دارد. یعنی operationsManager و energyManager می‌توانند درآمد را مستقیم از API بخوانند. اپ این ارقام را فقط پنهان می‌کند.
- **insightهای revenue:** این insightها در `aiInsights` برای هر نقشی که `ai.insights.view` دارد خواندنی‌اند.

PocketBase محدودیت در سطح فیلد ندارد. راه‌حل درست جدا کردن درآمد در یک collection مثل `dailyFinance` است، که یک تغییر schema افزودنی و مهاجرت داده لازم دارد. این بیشتر از دامنهٔ فاز ۰ است و پیشنهاد اولین کار فاز ۱ است.

**بازبینی context:** `POST /api/zarin/admin/ai/context {hotelId, userId}` فقط برای superuser است و فقط می‌خواند. همان context دقیقی را برمی‌گرداند که دستیار برای آن کاربر می‌سازد.

## ۳. امضای integration API

فایل: `pocketbase/pb_hooks/lib/integration.js`.

| | v1 (موجود) | v2 (تازه، scoped key) |
|---|---|---|
| هدرها | `x-zarin-timestamp`، `x-zarin-signature` | به‌علاوهٔ `x-zarin-key-id` و `x-zarin-nonce` (۱۶ تا ۶۴ کاراکتر) |
| رشتهٔ امضا | `${ts}.${body}` | `${ts}.${nonce}.${body}` |
| سکرت | `ZH_INTEGRATION_SECRET`، مشترک | سکرت همان کلید. در `integrationKeys` با `ZH_SECRETS_KEY` رمز می‌شود |
| دامنه | همهٔ routeهای `/v1` | فقط `/v1/hotels/{id}/…` و فقط هتل‌های داخل scope کلید (`403 key_not_allowed_for_hotel`) |
| replay | فقط پنجرهٔ ۵ دقیقه‌ای | هر nonce فقط یک بار پذیرفته می‌شود (`401 replayed_request`) |
| خاموش کردن | `ZH_ALLOW_SHARED_SECRET=false` | لغو کلید |

**مدیریت کلید** (superuser):

- **ساخت:** `npm run integration-key`، با پرسیدن label و شناسهٔ هتل‌ها. سکرت فقط یک بار و در ترمینال خود شما نمایش داده می‌شود.
- **لغو:** `npm run integration-key -- revoke <keyId>`.
- **routeها:** `POST /api/zarin/admin/integration-keys` و `…/{keyId}/revoke`.
- هر ساخت و لغو در `auditLogs` ثبت می‌شود.

workflowهای فعلی n8n بدون تغییر با v1 کار می‌کنند. انتقال n8n به v2 پشتیبانی nonce در نود Code لازم دارد و جزو فاز ۱ است.

**route در insights:** `POST /v1/hotels/{id}/insights` فقط مسیر داخلی اپ را می‌پذیرد، مثل `/energy` یا `/inventory/abc?tab=moves`. هر چیز دیگری خطای `400 invalid_route` می‌گیرد. در notifications مسیر نامعتبر دور ریخته می‌شود.

**بودجهٔ LLM برای worker:** این دو endpoint جدول `aiBudgets` را منبع واحد بودجه برای PocketBase و worker نگه می‌دارند:

- `GET /v1/hotels/{id}/ai/budget`
- `POST /v1/hotels/{id}/ai/usage {tokensIn, tokensOut}`

## ۴. پرچم‌های قابلیت به تفکیک هتل

قابلیت‌ها در `hotels.settings.features` تعریف می‌شوند و همه به‌طور پیش‌فرض خاموش‌اند. قابلیت‌های Batch 1 که پیش از این قاعده ساخته شده بودند، حالا پشت این پرچم‌ها هستند:

| پرچم | سرور | اپ |
|---|---|---|
| `energyBaseline` | هشدار انرژی بر پایهٔ مدل اشغال و فصل، و `GET /api/zarin/energy/analysis`. در حالت خاموش، قانون قدیمی خط مبنای ثابت اجرا می‌شود | بخش «خط مبنا» در صفحهٔ انرژی |
| `forecasts` | cron شبانه و هر دو route اجرای پیش‌بینی | صفحهٔ پیش‌بینی، تقویم رویدادها و کارت داشبورد |
| `recommendationLoop` | بستن خودکار و سنجش اثر توصیه‌ها در `runInsights` | — (ثبت تصمیم همچنان کار می‌کند) |

routeها در حالت خاموش خطای `400 feature_disabled` برمی‌گردانند. روشن یا خاموش کردن پرچم:

```bash
npm run hotel-features -- <hotelId>                    # نمایش
npm run hotel-features -- <hotelId> on energyBaseline,forecasts,recommendationLoop
npm run hotel-features -- <hotelId> off forecasts
```

کاربری که مجوز `hotel.settings` دارد (مثلاً GM) هم می‌تواند `settings.features` را تغییر دهد. هتل دمو در اپ همهٔ قابلیت‌ها را روشن دارد.

**پرچم build اپ:** `ZH_ENABLE_AI_ASSISTANT=false` (dart-define) این‌ها را پنهان می‌کند:

- دستیار در منو؛
- کارت «از دستیار بپرسید»؛
- route `/assistant` (که به access denied هدایت می‌شود).

اپ PocketBase به‌جای تاریخچه، `threadId` سرور را می‌فرستد.

## ۵. `ai-worker`

کد در [`ai-worker/`](../ai-worker) است. Python 3.11، با FastAPI و httpx.

| بخش | کار |
|---|---|
| `pb_client.py` | امضای v2 با کلید scoped و یک nonce تازه برای هر درخواست |
| `jobs.py` | jobها در SQLite با کلید idempotency (پیش‌فرض: hash نام، هتل و payload). retry با backoff نمایی و jitter. `PermanentError` بدون retry. بازیابی پس از crash |
| `llm/gateway.py` | زنجیرهٔ provider (اصلی ← fallback) با timeout. بودجهٔ هر هتل از PocketBase. cost log به JSONL (فقط عدد و وضعیت، بدون متن). redaction تلفن، کد ملی و نام. سقف `max_tokens` |
| `llm/providers.py` | `OpenAICompatibleProvider` (برای Liara AI، gateway دیگر، vLLM یا Ollama) و `MockProvider` برای آزمون |
| `builtin_jobs.py` | `ping` (خواندن summary با کلید scoped) و `llm_selftest` |
| `api.py` | `GET /health`، `POST /jobs/{name}` و `GET /jobs/{key}`، امضاشده با `ZH_WORKER_TRIGGER_SECRET` و nonce |

**چرا FastAPI:** لیارا برای برنامه پورت و health check می‌خواهد. n8n و PocketBase هم به یک راه امضاشده برای اجرای job نیاز دارند. منطق jobها به FastAPI وابسته نیست (`python -m worker run <job> <hotel>`).

**LiteLLM proxy یا ماژول داخلی؟** فعلاً ماژول داخلی. دلایل:

- یک مصرف‌کننده و حجم کم داریم؛
- بودجه در LiteLLM یک سرویس و دیتابیس اضافه می‌خواهد؛
- وابستگی کمتر یعنی سطح حملهٔ supply-chain کوچک‌تر.

رابط provider سازگار با OpenAI است، پس انتقال به LiteLLM یا vLLM فقط تغییر env است.

## ۶. ارزیابی فارسی

کد در [`ai-worker/eval/`](../ai-worker/eval).

**مجموعهٔ آزمون:** ۲۴ سؤال برای ۵ نقش، از چهار نوع: عادی، نشت مجوز، injection و بی‌داده. هر سؤال k=3 بار اجرا می‌شود.

**بررسی‌ها:**

| بررسی | معیار |
|---|---|
| وفاداری عددی | هر عدد پاسخ باید در context واقعی آن کاربر باشد. context از route بازبینی خوانده می‌شود |
| نشت | نقش بدون `finance.view` نه کلید مالی در context دارد، نه عدد مالی در پاسخ |
| بی‌داده | پاسخ می‌گوید داده وجود ندارد |
| تأخیر | p50 و p95 |

**دروازهٔ عبور:** وفاداری ۱۰۰٪ و صفر نشت. روش اجرا در [`ai-worker/eval/README.md`](../ai-worker/eval/README.md) آمده است.

## ۷. متغیرهای محیطی

مقادیر فقط در پنل لیارا یا ترمینال خود شما تنظیم می‌شوند. نمونهٔ placeholder در این دو فایل است: `pocketbase/deploy/.env.example` و `ai-worker/.env.example`.

**PocketBase (تازه یا تغییرکرده):**

| متغیر | توضیح |
|---|---|
| `ZH_SECRETS_KEY` | ۳۲ کاراکتر، برای رمزگذاری کلیدهای scoped. پس از ساخت کلید عوض نشود |
| `ZH_ALLOW_SHARED_SECRET` | پیش‌فرض `true`. وقتی همهٔ فراخواننده‌ها کلید scoped داشتند، `false` شود |
| `ZH_AI_PROVIDER` | `none`، `openai_compatible` یا `anthropic`. Anthropic از ایران در دسترس نیست |
| `ZH_AI_BASE_URL`، `ZH_AI_MODEL`، `ZH_AI_API_KEY` | endpoint سازگار با OpenAI. `ZH_AI_MODEL` الزامی است |
| `ZH_AI_MAX_TOKENS` | پیش‌فرض ۱۰۲۴ |
| `ZH_AI_TIMEOUT_SECONDS` | پیش‌فرض ۴۵ |
| `ZH_AI_MONTHLY_BUDGET_TOKENS` | پیش‌فرض ۲ میلیون برای هر هتل. `settings.ai.monthlyTokenBudget` آن را برای هر هتل جدا تغییر می‌دهد |
| `ZH_AI_RETENTION_DAYS` | پیش‌فرض ۹۰ |
| `ZH_AI_PRICE_IN_PER_MTOK`، `ZH_AI_PRICE_OUT_PER_MTOK` | برای محاسبهٔ هزینه |

**ai-worker:**

| متغیر | توضیح |
|---|---|
| `ZH_PB_URL`، `ZH_WORKER_KEY_ID`، `ZH_WORKER_SECRET` | آدرس PocketBase و کلید scoped |
| `ZH_WORKER_HOTEL_IDS` | هتل‌هایی که این worker سرویس می‌دهد |
| `ZH_WORKER_TRIGGER_SECRET` | امضای triggerها |
| `ZH_WORKER_DB` | پیش‌فرض `/data/worker.db` |
| `ZH_LLM_PROVIDER`، `ZH_LLM_BASE_URL`، `ZH_LLM_API_KEY`، `ZH_LLM_MODEL` | provider اصلی |
| `ZH_LLM_FALLBACK_MODEL`، `ZH_LLM_FALLBACK_BASE_URL`، `ZH_LLM_FALLBACK_API_KEY` | provider دوم برای fallback |
| `ZH_LLM_TIMEOUT_SECONDS`، `ZH_LLM_MAX_TOKENS` | محدودیت‌ها |
| `ZH_LLM_PRICE_*_PER_MTOK`، `ZH_LLM_COST_LOG` | هزینه و محل cost log |

**Flutter:** `ZH_ENABLE_AI_ASSISTANT` (پیش‌فرض `true`).

## ۸. اجرای محلی

```bash
cd pocketbase && npm test                       # سرور تست + mock n8n + mock LLM
cd app && flutter analyze && flutter test
cd pocketbase && npm run test-server            # برای تست adapter و worker
cd ai-worker && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt && pytest
```

## ۹. runbook استقرار (اجرا با شما، به ترتیب)

> هیچ‌کدام از این مراحل را من روی سرور اجرا نکرده‌ام. `liara deploy` را روی برنامهٔ PocketBase اجرا نکنید. روش به‌روزرسانی PocketBase همان [runbook ۰۹](09-liara-runbook.md#۲-بهروزرسانی-hookها-و-migrationهای-pocketbase) است.

1. **بکاپ:** از PocketBase روی لیارا بکاپ بگیرید (پنل PocketBase › Settings › Backups).
2. **کلید رمزگذاری:** در پنل لیارا، در env برنامهٔ PocketBase، `ZH_SECRETS_KEY` را بگذارید. یک رشتهٔ ۳۲ کاراکتری است که با `openssl rand -hex 16` در ترمینال خودتان ساخته می‌شود.
3. **به‌روزرسانی PocketBase:** hookها و migrationها را طبق runbook ۰۹ به‌روز کنید. migration تازه `1760400000_ai_phase0.js` فقط افزودنی است.
4. **راه‌اندازی مجدد و بررسی:** برنامه را restart کنید و در لاگ ببینید migration اجرا شده است.
5. **بررسی دستیار در اپ:**
   - با یک حساب energyManager دربارهٔ درآمد بپرسید. پاسخ باید بگوید «دسترسی ندارید».
   - تا وقتی `ZH_AI_PROVIDER=none` است، پاسخ‌ها قاعده‌محور می‌مانند.
6. **پرچم‌ها برای هتل trial پارسیان:**

   ```bash
   cd pocketbase && npm run hotel-features -- <trial-hotel-id> on energyBaseline,forecasts,recommendationLoop
   ```

   برای هتل واقعی پرچمی روشن نکنید، مگر با تصمیم خودتان.
7. **(اختیاری) Liara AI:**
   - در پنل لیارا کلید و آدرس endpoint را بگیرید.
   - روی PocketBase این‌ها را تنظیم کنید: `ZH_AI_PROVIDER=openai_compatible`، `ZH_AI_BASE_URL`، `ZH_AI_MODEL` و `ZH_AI_API_KEY`.
   - پیش از آن، eval را محلی با همین مدل اجرا کنید (بخش ۶). کلید را در چت نفرستید.
8. **(وقتی worker لازم شد) ساخت برنامهٔ Docker تازه در لیارا** برای `ai-worker`:
   - یک disk به مسیر `/data` وصل کنید.
   - یک کلید scoped برای هتل trial بسازید (`npm run integration-key`).
   - این env‌ها را روی برنامهٔ worker بگذارید: `ZH_PB_URL`، `ZH_WORKER_KEY_ID`، `ZH_WORKER_SECRET`، `ZH_WORKER_HOTEL_IDS` و `ZH_WORKER_TRIGGER_SECRET`.
   - از داخل پوشهٔ `ai-worker` (نه پوشهٔ PocketBase) deploy کنید.
   - بررسی کنید: `GET /health` باید `missingConfig: []` نشان دهد. سپس از ترمینال برنامه `python -m worker run ping <hotelId>` را اجرا کنید.
9. **منبع آب‌وهوا برای فاز ۱:** از ترمینال برنامهٔ worker در لیارا امتحان کنید که API آب‌وهوای مورد نظر در دسترس است.

## ۱۰. شکاف‌های هم‌ترازی با Firebase

قابلیت‌های فاز ۰ فقط در PocketBase پیاده شده‌اند. در backend Firebase:

- callable `aiAssistant` هنوز همان context کامل را بدون فیلتر مجوز می‌سازد و تاریخچهٔ گوشی را می‌پذیرد؛
- integration API کلید scoped و nonce ندارد؛
- پرچم‌های قابلیت و `aiBudgets` وجود ندارند.

Firebase در استقرار ایران استفاده نمی‌شود. اگر روزی فعال شود، این موارد باید پیش از آن اصلاح شوند.
