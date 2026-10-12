# ۱۷. فاز ۰.۵: جدا کردن درآمد، مجوز `finance.record`، کلید scoped برای n8n و runbook استقرار

این سند تغییرات فاز ۰.۵ و ترتیب دقیق استقرار فاز ۰ و ۰.۵ روی لیارا را شرح می‌دهد. یافتهٔ باز سند [۱۶](16-ai-architecture.md#۲-دستیار-چه-چیزی-بسته-شد) (خوانده شدن درآمد از REST و insightهای revenue) در این فاز بسته شده است.

> هیچ‌کدام از مراحل بخش ۶ را من روی سرور اجرا نکرده‌ام. همه‌چیز فقط محلی آزموده شده است. `liara deploy` را روی برنامهٔ PocketBase اجرا نکنید.

## ۱. درآمد فقط‌نوشتنی

| | پیش از فاز ۰.۵ | پس از فاز ۰.۵ |
|---|---|---|
| محل درآمد روزانه | فیلدهای `roomRevenue`، `fnbRevenue` و `otherRevenue` در `dailyOperations` | collection تازهٔ `dailyFinance` (یک ردیف برای هر هتل و روز) |
| خواندن درآمد | هر نقشی که `dailyOperations` را می‌خواند (از جمله energyManager و operationsManager) | فقط `finance.view` |
| ADR، RevPAR و درآمد کل در `dailyMetrics` | در ستون‌ها و JSON `data` | در `dailyFinance`. ستون‌های `dailyMetrics` صفر و `hidden` هستند و کلیدهای مالی از `data` حذف شده‌اند |
| ثبت درآمد | `operations.recordDaily` | مجوز صریح **`finance.record`** |
| مسیر نوشتن | REST مستقیم روی `dailyOperations` | فقط `POST /api/zarin/operations/daily`. نوشتن REST روی `dailyOperations` فقط برای superuser است |
| نمایش در فرم | مقدار ذخیره‌شده پیش‌پر می‌شد | هرگز نمایش داده نمی‌شود. فرم فقط می‌گوید «درآمد این روز ثبت شده است» یا «ثبت نشده است» |
| اصلاح | ویرایش مقدار | ثبت دوباره. آخرین ثبت جایگزین می‌شود |

**مجوز `finance.record`** (کاتالوگ اکنون ۳۳ مجوز دارد):

- پیش‌فرض: superAdmin، generalManager، operationsManager و receptionStaff.
- با `roleOverrides` هر هتل قابل محدود کردن است. override فقط قالب نقش را محدود می‌کند و هرگز چیزی اضافه نمی‌کند.
- migration به overrideهای موجودی که `operations.recordDaily` دارند `finance.record` را هم می‌دهد. یعنی هیچ کاربری توانایی ثبت درآمد را از دست نمی‌دهد.
- ثبت درآمد مستقل از `finance.view` است. پذیرش می‌تواند درآمد را ثبت کند، ولی نمی‌تواند آن را بخواند.

**فرم «ثبت روزانه» در اپ:**

1. فیلدهای درآمد همیشه خالی‌اند.
2. اگر درآمدی تایپ شده باشد، پیش از ذخیره یک صفحهٔ تأیید با همان اعداد تایپ‌شده و جمع آن‌ها نشان داده می‌شود. «ویرایش ارقام» برمی‌گردد و چیزی ذخیره نمی‌شود.
3. پس از ذخیره، فیلدها پاک می‌شوند.
4. اگر درآمدی تایپ نشده باشد، فقط اشغال و تعداد مهمان ذخیره می‌شود و درآمد قبلی دست نمی‌خورد.
5. Audit log فقط `revenueEntered: true|false` را ثبت می‌کند، نه مبلغ را.

**نشت‌های دیگری که بسته شد:**

| مسیر | قانون تازه |
|---|---|
| `aiInsights` با `category = 'revenue'` | فقط کاربرانی که `users.financeView = true` دارند |
| `forecasts` و `forecastRuns` با سری‌های `roomRevenue` و `totalRevenue` | همان |
| `reports` با `containsFinance = true` | همان. hook هنگام ساخت گزارش این فیلد را تنظیم می‌کند |
| insight «اتاق‌های خارج از سرویس» | دو insight شد: نسخهٔ درآمدی (فقط GM، مالک و تحلیل‌گر، و فقط اگر درآمد صفر نباشد) و نسخهٔ `outOfOrder_rooms` بدون عدد مالی، برای GM، تعمیرات و عملیات |
| داشبورد، PDF خلاصهٔ مدیریتی و صفحهٔ پیش‌بینی در اپ | ردیف‌ها و سری‌های مالی فقط با `finance.view` |
| دستیار AI | از فاز ۰ context مالی فقط با `finance.view` ساخته می‌شود |

`users.financeView` یک فیلد bool است که hook از روی نقش و override محاسبه می‌کند و کاربر نمی‌تواند آن را تغییر دهد. علت وجودش: در PocketBase دو شرط `@request.auth.permissions.code ?=` در یک قانون باید با **یک** ردیف مجوز برقرار شوند، پس «`ai.insights.view` و `finance.view`» هرگز با هم درست نمی‌شد.

**آزمون‌های امنیتی `financeView`** (در `finance-access.test.mjs`):

- **هیچ کلاینتی نمی‌تواند آن را تنظیم کند:**
  - PATCH روی رکورد خود (JSON، multipart، همراه با فیلد مجاز و از طریق `permissions`) با `400 field_not_allowed` رد می‌شود.
  - PATCH روی رکورد کاربر دیگر `404` می‌گیرد.
  - batch API خاموش است.
  - `financeView` در بدنهٔ همهٔ routeهای `/api/zarin/*` که کاربر را تغییر می‌دهند یا لمس می‌کنند نادیده گرفته می‌شود.
  - حتی نوشتن superuser هم آن را عوض نمی‌کند، چون model hook مقدار را دوباره از نقش محاسبه می‌کند.
- **همگام‌سازی در هر دو جهت:**
  - **تغییر نقش با route مدیر:** نشست‌های کاربر باطل می‌شوند. توکن قدیمی مثل مهمان رفتار می‌کند: routeهای نیازمند ورود `401` می‌گیرند و فهرست‌ها خالی‌اند. ورود بعدی دقیقاً دسترسی نقش تازه را دارد.
  - **تغییر نقش از پنل superuser:** همان توکن از درخواست بعدی دسترسی را می‌گیرد یا از دست می‌دهد.
  - **ساخت، ویرایش یا حذف `roleOverrides`:** همان توکن بلافاصله دسترسی را از دست می‌دهد یا دوباره می‌گیرد، هم در REST و هم در اشتراک realtime باز.
- **کنترل جهش:** با برداشتن guard یا hook همگام‌سازی، همین آزمون‌ها شکست می‌خورند.

**محدودیت شناخته‌شده:** مجوزهای کاربر، از جمله `financeView`، از override **هتل اصلی** او (`primaryHotel`) محاسبه می‌شوند. کاربری که عضو چند هتل است، در هتل دیگر هم همان دسترسی را دارد، حتی اگر آن هتل override محدودتری داشته باشد. این رفتار برای همهٔ مجوزها از پیش وجود داشته و مخصوص درآمد نیست. کاربرانی که با `POST /api/zarin/users` ساخته می‌شوند فقط عضو یک هتل‌اند. وضعیت کاربران روی لیارا را بررسی نکرده‌ام: در پنل `/_/` ← `users`، فیلتر `hotels:length > 1` آن‌ها را نشان می‌دهد.

**realtime:** فیلدهای `hidden` در رویدادهای realtime هم ارسال نمی‌شوند. این با یک کلاینت SSE خام آزموده شده است (`finance-access.test.mjs`).

## ۲. migrationها

طبق آخرین به‌روزرسانی ثبت‌شده در runbookها، سرور لیارا نسخهٔ `1544bc1` را اجرا می‌کند که فقط `1759700000` و `1759800000` را دارد. پس این استقرار **پنج** migration اجرا می‌کند: دو migration مرحلهٔ ۱ (Batch 1) و سه migration فاز ۰ و ۰.۵. قابلیت‌های Batch 1 پشت پرچم‌هایی هستند که پیش‌فرض خاموش‌اند.

| فایل | کار | down |
|---|---|---|
| `1760300000_ai_forecasts_recommendations.js` | Batch 1: `calendarEvents`، `forecasts`، `forecastRuns` و فیلدهای پیگیری تصمیم و نتیجه در `aiInsights` | دارد |
| `1760300100_notification_dedupe.js` | Batch 1: کلید dedupe در `notifications`، تا escalation پیاپی SLA در n8n تکرار نشود | دارد |
| `1760400000_ai_phase0.js` | فاز ۰: `integrationKeys`، `integrationNonces`، `aiBudgets`، `aiConversations`، پرچم‌ها | دارد |
| `1760500000_finance_record_permission.js` | مجوز `finance.record`، قالب نقش‌ها، overrideها، فیلد `users.financeView` | دارد |
| `1760500100_daily_finance.js` | ساخت `dailyFinance`، کپی درآمد و متریک‌های مالی، صفر و `hidden` کردن ستون‌های قدیمی، حذف کلیدهای مالی از JSON `data` در `dailyMetrics`، قوانین تازه | دارد. مقدارهای قبلی `dailyMetrics` (از جمله `null` و نبودن کلید) در فیلد پنهان `migratedFrom` نگه داشته می‌شوند تا down دقیقاً همان را برگرداند. درآمدی که پس از استقرار ثبت شده هم به `dailyOperations` برمی‌گردد |

همهٔ تغییرات افزودنی‌اند. هیچ فیلد یا collectionی حذف یا تغییر نام داده نمی‌شود. ستون‌های قدیمی می‌مانند و فقط صفر و پنهان می‌شوند.

**آزمون محلی up/down** روی دادهٔ seed:

1. up: درآمد و متریک‌ها دقیقاً کپی شدند، ستون‌های قدیمی صفر شدند و بقیهٔ `data` دست نخورد.
2. down: همه‌چیز دقیقاً برگشت. تنها تفاوت، ترتیب کلیدهای JSON بود.
3. up دوباره: درست کار کرد.

## ۳. n8n با کلید scoped

workflowهای ۰۲، ۰۳ و ۰۴ در نود Sign این رفتار را دارند:

- اگر `ZARIN_KEY_ID` و `ZARIN_KEY_SECRET` تنظیم شده باشند، با امضای v2 (کلید و nonce) امضا می‌کنند.
- در غیر این صورت مثل قبل با `ZARIN_INTEGRATION_SECRET` (v1) امضا می‌کنند.

پس import کردن workflowهای تازه پیش از ساخت کلید بی‌خطر است. `ZARIN_INTEGRATION_SECRET` در هر حال لازم می‌ماند، چون n8n امضای رویدادهای PocketBase را با آن بررسی می‌کند. `ZH_ALLOW_SHARED_SECRET` روی PocketBase پیش‌فرض `true` است، پس n8n فعلی پس از استقرار بدون تغییر کار می‌کند.

آزمون‌ها (n8n 2.35.7 و 2.26.2): `npm run e2e`، `npm run e2e:scoped` و `npm run e2e:scoped-only` در `n8n/test`. در حالت scoped-only، درخواست امضاشده با shared secret رد می‌شود و workflowها باز هم کامل اجرا می‌شوند.

## ۴. Firebase: فریز

- **backend پشتیبانی‌شده PocketBase است.** Firebase برای قابلیت‌های تازه فریز است و هیچ قابلیت فاز ۰ یا بعد از آن در آن پیاده نمی‌شود.
- `firebase/functions/src/analytics/rules-engine.ts` و `firebase/functions/src/domain/rbac.ts` همچنان **منبع** کد مشترک‌اند:
  - `npm run build:core` از آن‌ها `pocketbase/pb_hooks/lib/core.js` را می‌سازد؛
  - `npm run gen:rules` بلوک RBAC در `firebase/firestore.rules` را می‌سازد؛
  - تست drift، ماتریس `rbac.ts` را با `app/lib/core/security/role_policy.dart` مقایسه می‌کند.
- تست‌های موجود Firebase (۱۸ تست واحد و `tsc`) سبز می‌مانند.

**«هیچ هتلی روی Firebase نیست»:** از داخل مخزن نمی‌توانم این را قطعی ثابت کنم، چون پروژهٔ Firebase بیرون از مخزن است. شواهد مخزن با آن سازگار است:

- در `app/lib/firebase_options.dart`، مقدار `appId` هنوز `REPLACE_ME` است.
- `bootstrap.dart` در این حالت حتی با `ZH_BACKEND=firebase` به backend دمو برمی‌گردد. پس هیچ APKی از این مخزن به Firebase وصل نشده است.

اگر خلاف آن را می‌دانید، بگویید.

**شکاف‌های Firebase** (اگر روزی فعال شود، پیش از آن باید بسته شوند):

| موضوع | وضعیت در Firebase |
|---|---|
| درآمد | هنوز در سند `dailyOperations` است. Firestore rules خواندن آن را به `finance.view` محدود نمی‌کند. adapter اپ درآمد را فقط وقتی می‌نویسد که وارد شده باشد (merge)، ولی جداسازی خواندن وجود ندارد |
| `finance.record` | در بلوک RBAC تولیدشده هست، ولی هیچ rule یا function آن را از `operations.recordDaily` جدا اجرا نمی‌کند |
| insightهای revenue، گزارش‌ها و پیش‌بینی‌ها | بدون فیلتر `finance.view` |
| دستیار AI | callable `aiAssistant` context را بدون فیلتر مجوز می‌سازد و تاریخچهٔ گوشی را می‌پذیرد |
| integration API | کلید scoped و nonce ندارد |
| پرچم‌های قابلیت، `aiBudgets` و Recommendation Center | وجود ندارند |

## ۵. سازگاری نسخه‌های اپ

| | سرور قدیم | سرور تازه |
|---|---|---|
| **APK قدیم** | درست | درآمد در داشبورد و فرم خالی است و **ذخیرهٔ «ثبت روزانه» خطا می‌دهد**، چون نوشتن REST روی `dailyOperations` بسته است |
| **APK تازه** | ذخیرهٔ «ثبت روزانه» خطای 404 می‌دهد (route وجود ندارد) و خواندن `dailyFinance` شکست می‌خورد | درست |

پس **APK تازه باید هم‌زمان با به‌روزرسانی hookها پخش شود**: پیش از استقرار ساخته و آماده باشد و بلافاصله پس از بررسی سرور روی همهٔ گوشی‌ها نصب شود. بهترین زمان، ساعت کم‌کار پذیرش است.

نوشتن REST برای اپ قدیم عمداً بسته شده است. فیلدهای `hidden` در PocketBase از بدنهٔ درخواست کاربر عادی بی‌صدا حذف می‌شوند، پس اگر باز می‌ماند، درآمدی که اپ قدیم می‌فرستاد بدون هیچ خطایی گم می‌شد. یک خطای آشکار بهتر از گم شدن بی‌صدای داده است.

## ۶. runbook استقرار فاز ۰ و ۰.۵ (اجرا با شما، به ترتیب)

پیش‌نیاز: Mac آماده طبق [runbook ۰۹، بخش ۱](09-liara-runbook.md#۱-آمادهسازی-mac-یک-بار) و Flutter طبق [۱۰](10-flutter-app.md).

### ۶.۱ ساخت APK تازه (پیش از هر تغییری روی سرور)

```zsh
cd ~/test23 && git fetch origin && git checkout ai/phase-0.5-finance && git pull
cd app && flutter pub get
flutter build apk --release \
  --dart-define=ZH_BACKEND=pocketbase \
  --dart-define=ZH_PB_URL=https://zarin-hoshmand-nieplltrhr.liara.run
```

- خروجی: `build/app/outputs/flutter-apk/app-release.apk`.
- هنوز آن را پخش نکنید.
- اگر دستیار AI نباید در منو باشد، `--dart-define=ZH_ENABLE_AI_ASSISTANT=false` را اضافه کنید.

### ۶.۲ بکاپ (اجباری، پیش از هر migration)

1. پنل PocketBase روی لیارا (`/_/`) ← Settings ← Backups ← «Initialize new backup».
2. پس از پایان، فایل zip را **دانلود کنید** و بیرون از سرور نگه دارید. بکاپی که فقط روی همان دیسک است، در خرابی دیسک کمکی نمی‌کند.
3. نام و زمان بکاپ را یادداشت کنید. نقطهٔ بازگشت همین فایل است.
4. **بررسی نسخهٔ فعلی:** در پنل `/_/` ← Collections نباید `forecasts`، `dailyFinance` یا `integrationKeys` وجود داشته باشد. اگر وجود دارند، سرور نسخهٔ دیگری را اجرا می‌کند. پیش از ادامه به من بگویید.

### ۶.۳ متغیرهای PocketBase

در پنل لیارا ← برنامهٔ PocketBase ← تنظیمات ← متغیرهای محیطی:

| متغیر | مقدار |
|---|---|
| `ZH_SECRETS_KEY` | ۳۲ کاراکتر: در ترمینال خودتان `openssl rand -hex 16 \| pbcopy` و paste. پس از ساخت اولین کلید scoped دیگر عوض نشود |
| `ZH_ALLOW_SHARED_SECRET` | تنظیم نکنید (پیش‌فرض `true`). در مرحلهٔ ۶.۸ خاموش می‌شود |
| `ZH_AI_PROVIDER` | تنظیم نکنید (پیش‌فرض `none`، یعنی پاسخ قاعده‌محور) |

مقدار هیچ‌کدام را در چت نفرستید.

### ۶.۴ به‌روزرسانی hookها و migrationها

همان دستور [runbook ۰۹، بخش ۲](09-liara-runbook.md#۲-بهروزرسانی-hookها-و-migrationهای-pocketbase)، با شاخهٔ این فاز. در پنل لیارا ← برنامهٔ PocketBase ← «خط فرمان»:

```sh
B=ai/phase-0.5-finance
cd /tmp && rm -rf test23-* s.tgz \
  && wget -qO s.tgz "https://codeload.github.com/alireza4585/test23/tar.gz/refs/heads/$B" \
  && tar xzf s.tgz \
  && cp -r test23-*/pocketbase/pb_migrations/. /pb_migrations/ \
  && cp -r test23-*/pocketbase/pb_hooks/. /pb_hooks/ \
  && rm -rf test23-* s.tgz && echo "copied"
```

PocketBase پس از تغییر `/pb_hooks` خودش restart می‌شود و پنج migration تازه را به ترتیب اجرا می‌کند: `1760300000`، `1760300100`، `1760400000`، `1760500000` و `1760500100`. اگر پس از یک دقیقه restart نشد، از پنل لیارا «راه‌اندازی مجدد» بزنید.

### ۶.۵ بررسی سرور

1. `https://zarin-hoshmand-nieplltrhr.liara.run/v1/health` باید `{"ok":true,…}` برگرداند.
2. در لاگ لیارا خطای migration نباشد.
3. پنل `/_/` ← Collections:
   - `dailyFinance` وجود دارد و ردیف‌های آن با روزهای دارای درآمد هتل‌ها می‌خواند؛
   - در `dailyOperations` فیلد `financeRecorded` هست؛
   - در `users` فیلد `financeView` هست.
4. پنل `/_/` ← Collections ← `permissions`: باید ۳۳ ردیف باشد، از جمله `finance.record`.

### ۶.۶ پخش APK (بلافاصله)

1. APK مرحلهٔ ۶.۱ را روی گوشی پذیرش، مدیر عملیات و مدیرکل نصب کنید: `adb install -r build/app/outputs/flutter-apk/app-release.apk`، یا ارسال فایل.
2. آزمون دستی:
   - **پذیرش:** «ثبت روزانه» ← فیلدهای درآمد خالی‌اند ← یک مبلغ وارد کنید ← صفحهٔ تأیید همان اعداد را نشان می‌دهد ← «تأیید و ذخیره» ← پیام «درآمد این روز ثبت شده است».
   - **همان کاربر:** هیچ عدد درآمدی در داشبورد نمی‌بیند.
   - **مدیرکل:** RevPAR و ADR دیروز را در داشبورد می‌بیند.
   - **مدیر انرژی یا مدیر عملیات:** هیچ کارت مالی ندارد و در «پیش‌بینی‌ها» سری درآمد نمی‌بیند.

### ۶.۷ پرچم‌ها برای هتل trial

```zsh
cd ~/test23/pocketbase
npm run hotel-features -- c37f7qdkfoc87x0
npm run hotel-features -- c37f7qdkfoc87x0 on energyBaseline,forecasts,recommendationLoop
```

- اسکریپت آدرس سرور و ایمیل و رمز superuser را می‌پرسد و رمز روی صفحه نمایش داده نمی‌شود.
- برای هتل واقعی (`j27oy3pm9rtrp9e`) پرچمی روشن نکنید. بدون `recommendationLoop`، صفحهٔ insightها همان دکمه‌های قدیمی «پذیرش، اجرا شد، رد» را دارد.

### ۶.۸ n8n با کلید scoped

1. **workflowها:** workflowهای ۰۲، ۰۳ و ۰۴ را از همین شاخه دوباره import کنید، طبق [runbook ۰۹، بخش ۴](09-liara-runbook.md#۴-بهروزرسانی-workflowها-در-n8n). تا پیش از قدم ۳، همچنان با shared secret امضا می‌کنند.
2. **ساخت کلید** روی Mac:

   ```zsh
   cd ~/test23/pocketbase && npm run integration-key
   ```

   - label: مثلاً `n8n`.
   - hotel ids: همان‌هایی که در `ZARIN_HOTEL_IDS` در n8n هست.
   - شناسه و سکرت کلید فقط یک بار در ترمینال شما نمایش داده می‌شوند.
3. **env برنامهٔ n8n در لیارا:** `ZARIN_KEY_ID` و `ZARIN_KEY_SECRET` را بگذارید و برنامه را restart کنید. `ZARIN_INTEGRATION_SECRET` را حذف نکنید.
4. **آزمون:** یک تیکت بحرانی در هتل trial ثبت کنید. در n8n ← Executions، اجرای workflow ۰۲ باید موفق باشد. در پنل PocketBase ← `integrationNonces` باید ردیف تازه‌ای با شناسهٔ همین کلید دیده شود.
5. **خاموش کردن shared secret:** فقط پس از تأیید خودتان، `ZH_ALLOW_SHARED_SECRET=false` را روی PocketBase بگذارید. اگر چیزی شکست، آن را به `true` برگردانید.

### ۶.۹ آزمون منبع آب‌وهوا (برای فاز ۱)

در پنل لیارا ← برنامهٔ n8n ← «خط فرمان»:

```sh
cd /tmp && wget -qO wp.sh "https://raw.githubusercontent.com/alireza4585/test23/refs/heads/ai/phase-0.5-finance/ai-worker/tools/weather-probe.sh" && sh wp.sh; rm -f wp.sh
```

برای مختصات هتل، پیش از `sh` مقدارهای `LAT=… LON=…` را بگذارید. خروجی (کد HTTP و زمان پاسخ) را در چت بفرستید. این خروجی هیچ کلیدی ندارد.

## ۷. بازگشت (rollback)

**راه اول: بکاپ، برگشت به نسخهٔ فعلی لیارا (`1544bc1`).** ساده‌ترین راه است، ولی دادهٔ ثبت‌شده پس از بکاپ از بین می‌رود. ترتیب مهم است: اگر اول بکاپ را restore کنید، PocketBase با hookها و migrationهای تازه restart می‌شود و همان پنج migration را دوباره اجرا می‌کند.

1. در «خط فرمان» برنامهٔ PocketBase، migrationهای تازه را پاک کنید:

   ```sh
   cd /pb_migrations && rm -f 1760300000_ai_forecasts_recommendations.js 1760300100_notification_dedupe.js \
     1760400000_ai_phase0.js 1760500000_finance_record_permission.js 1760500100_daily_finance.js && ls
   ```

2. hookهای نسخهٔ فعلی را با دستور ۶.۴ و این مقدار کپی کنید: `B=1544bc147a3c455a8b6e58ac56fee756ff9a18a5`. در آدرس `wget`، به‌جای `refs/heads/$B` فقط `$B` بنویسید. فایل‌های تازهٔ `lib/` که می‌مانند، بی‌اثرند.
3. پنل `/_/` ← Settings ← Backups ← فایل بکاپ مرحلهٔ ۶.۲ ← Restore.
4. APK قبلی را دوباره نصب کنید.

**راه دوم: migration down، برگشت به فاز ۰.** درآمد ثبت‌شده پس از استقرار حفظ می‌شود و به `dailyOperations` برمی‌گردد:

1. در «خط فرمان» برنامهٔ PocketBase:

   ```sh
   echo y | /usr/local/bin/pocketbase migrate down 2 --dir=/pb_data --hooksDir=/pb_hooks --migrationsDir=/pb_migrations
   rm -f /pb_migrations/1760500000_finance_record_permission.js /pb_migrations/1760500100_daily_finance.js
   ```

2. hookهای فاز ۰ را با دستور ۶.۴ و `B=ai/phase-0-foundation` کپی کنید. این کار restart را راه می‌اندازد.
3. APKی را که از شاخهٔ `ai/phase-0-foundation` ساخته‌اید نصب کنید. APK نسخهٔ `1544bc1` هم با این سرور کار می‌کند.

با این راه، `dailyMetrics` (ستون‌ها و JSON `data`) با `migratedFrom` دقیقاً به حالت پیش از migration برمی‌گردد. این مسیر روی دادهٔ محلی آزموده شده، نه روی لیارا، پس پیش از آن هم بکاپ تازه بگیرید.

## ۸. آزمون‌ها

| مجموعه | نتیجه |
|---|---|
| PocketBase (`cd pocketbase && npm test`) | ۱۴۲ از ۱۴۲. شامل `finance-access.test.mjs` (۲۶ آزمون): ۸ نقش بدون مجوز مالی از REST (list، view و filter) درآمد نمی‌بینند؛ insight، گزارش و پیش‌بینی مالی دیده نمی‌شوند؛ مسیر نوشتن، اصلاح، override، realtime، و ۷ آزمون امنیتی `financeView` |
| Flutter | `flutter analyze` بدون خطا. ۵۳ تست سبز و ۱۱ skip (تست‌های adapter که فقط با سرور محلی اجرا می‌شوند) |
| Flutter adapter روی PocketBase محلی | ۱۱ از ۱۱ |
| Firebase functions | `tsc` بدون خطا، ۱۸ از ۱۸. `check:core` و `gen:rules` بدون تغییر |
| ai-worker | pytest: ۳۲ سبز، ۳ skip (آزمون‌های live که کلید لازم دارند) |
| n8n e2e | 2.35.7: shared، scoped و scoped-only. 2.26.2: shared و scoped-only. همه سبز |
| import محلی دیتاست پارسیان | ۳۷ مورد منطبق، ۱ اختلاف شناخته‌شده (`tasks.csv`)، ۹ مورد دستی. ADR و RevPAR از `dailyFinance` با Test_Scenarios می‌خوانند |
