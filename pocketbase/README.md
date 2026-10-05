# بک‌اند PocketBase — زرین هوشمند

این پوشه سرور کامل زرین هوشمند روی **PocketBase (نسخهٔ 0.40)** است. PocketBase یک فایل اجرایی واحد است و روی هر سروری اجرا می‌شود، از جمله سرور داخل ایران. Auth، دیتابیس SQLite، Realtime، فایل و API در همان یک فایل هستند و منطق ما به‌صورت hookهای JavaScript کنار آن قرار می‌گیرد.

همهٔ قابلیت‌های نسخهٔ Firebase اینجا هم پیاده شده است: نقش‌ها و مجوزها، ایزوله‌سازی هتل‌ها، Audit log، هشدار و اعلان، تحلیل شبانه، پیشنهادهای هوشمند، دستیار AI، API امضاشده برای n8n و دریافت داده از کنتورهای هوشمند.

```
pocketbase/
├── pb_migrations/        طرح دیتابیس: ۲۷ collection، قوانین دسترسی (API rules)، ایندکس‌ها، کاتالوگ نقش‌ها
├── pb_hooks/
│   ├── zarin.pb.js       ثبت route‌ها، hook‌ها و cron‌ها
│   └── lib/              منطق: users · ops · analytics · ai · integration · audit · zarin (helpers)
│       └── core.js       تولیدشده از کد TypeScript مشترک (RBAC، کد ملی، KPI، موتور قواعد)
├── scripts/              seed دمو · create-hotel · test-server · build-core · get-pocketbase
├── test/                 ۴۲ تست روی سرور واقعی (امنیت، workflowها، API یکپارچه‌سازی)
├── Dockerfile            ایمیج سرور
└── deploy/               docker-compose + Caddy (HTTPS خودکار) + .env.example
```

## امنیت در PocketBase

| لایه | پیاده‌سازی |
|---|---|
| ورود | کد ملی فیلد identity در collection `users` است و رمز با bcrypt ذخیره می‌شود. کد ملی **hidden** است و هیچ‌وقت در پاسخ API برنمی‌گردد. حساب‌های غیرفعال با `authRule` نمی‌توانند وارد شوند. Rate limit ورود فعال است |
| ایزوله‌سازی هتل | هر رکورد فیلد `hotel` دارد و rule آن `@request.auth.hotels.id ?= hotel` است |
| RBAC | فیلد `users.permissions` یک relation به کاتالوگ `permissions` است که **سرور** از روی قالب نقش (و override هتل) محاسبه می‌کند. Ruleها `@request.auth.permissions.code ?= '…'` را بررسی می‌کنند و کاربر نمی‌تواند نقش یا مجوز خودش را تغییر دهد |
| Workflowها | تغییر وضعیت اتاق، تسک، تیکت و موجودی انبار فقط از طریق routeهای تراکنشی `/api/zarin/*` انجام می‌شود. این routeها انتقال‌های مجاز هر نقش و همزمانی را بررسی می‌کنند |
| یکپارچگی | فیلدهایی مثل گزارش‌دهنده، SLA و ثبت‌کننده را سرور پر می‌کند. ارجاع به رکورد هتل دیگر رد می‌شود. Ledger انبار و timeline تیکت فقط توسط سرور نوشته می‌شوند |
| Audit | هر تغییر کاربر با actor و diff در `auditLogs` ثبت می‌شود |

## اجرای محلی

```bash
cd pocketbase
npm install
./scripts/get-pocketbase.sh          # دانلود PocketBase 0.40.4 در ./bin (یا PB_BIN=…)
npm test                             # ۴۲ تست روی یک سرور موقت
npm run test-server                  # سرور موقت seedشده، برای اجرای اپ یا تست‌های Flutter
```

اپ را با این دستور به سرور وصل کنید:

```bash
cd app
flutter run --dart-define=ZH_BACKEND=pocketbase --dart-define=ZH_PB_URL=http://10.0.2.2:PORT   # شبیه‌ساز اندروید
ZH_PB_TEST_URL=http://127.0.0.1:PORT flutter test test/pocketbase                               # ۸ تست adapter
```

## استقرار روی سرور شما

### روش پیشنهادی: Docker + Caddy (HTTPS خودکار)

پیش‌نیازها: سرور لینوکس با Docker، یک دامنه یا زیردامنه (مثلاً `api.hotel.ir`) که رکورد A آن به IP سرور اشاره کند، و پورت‌های ۸۰ و ۴۴۳ باز.

```bash
git clone https://github.com/alireza4585/test23.git && cd test23/pocketbase/deploy
cp .env.example .env            # ZH_DOMAIN و ZH_INTEGRATION_SECRET را پر کنید (openssl rand -hex 32)
docker compose up -d --build
docker compose exec pocketbase /pb/pocketbase superuser upsert admin@hotel.ir 'رمز-قوی' --dir=/pb/pb_data
```

اگر سرور به GitHub دسترسی ندارد، فایل `pocketbase_0.40.4_linux_amd64.zip` را دستی دانلود کنید، با نام `pocketbase.zip` کنار `Dockerfile` بگذارید و دوباره build کنید.

### بدون Docker (systemd)

```bash
# فایل اجرایی PocketBase در /opt/zarin/pocketbase، و پوشه‌های pb_hooks و pb_migrations کنار آن
/opt/zarin/pocketbase serve --http=127.0.0.1:8090 --automigrate=false \
  --dir=/opt/zarin/pb_data --hooksDir=/opt/zarin/pb_hooks --migrationsDir=/opt/zarin/pb_migrations
```

این دستور را در یک سرویس systemd بگذارید و Caddy یا nginx را جلوی آن قرار دهید. در nginx برای Realtime بافر را خاموش کنید (`proxy_buffering off`). متغیرهای `.env.example` را در `Environment=` سرویس تعریف کنید.

### هاست مدیریت‌شدهٔ PocketBase

اگر سرویسی خریده‌اید که فقط پنل PocketBase می‌دهد، پوشه‌های `pb_hooks` و `pb_migrations` را از طریق پنل یا FTP آن سرویس آپلود کنید، متغیرهای محیطی را در پنل تعریف کنید و سرویس را restart کنید.

### پس از نصب

1. **ساخت هتل و مدیرکل:**
   ```bash
   cd pocketbase && npm install
   ZH_PB_URL=https://api.hotel.ir ZH_PB_SUPERUSER_EMAIL=… ZH_PB_SUPERUSER_PASSWORD=… \
   HOTEL_NAME="…" HOTEL_CITY="…" HOTEL_ROOMS=80 GM_NATIONAL_ID=… GM_NAME="…" GM_TEMP_PASSWORD='…' \
   npm run create-hotel
   ```
   مدیرکل در اولین ورود رمز را عوض می‌کند و بقیهٔ کاربران را از داخل اپ می‌سازد. برای دمو به‌جای این کار `npm run seed` را اجرا کنید که هتل ۶۰ اتاقه با ۱۶ نقش می‌سازد.
2. **اپ:**
   ```bash
   flutter build apk --dart-define=ZH_BACKEND=pocketbase --dart-define=ZH_PB_URL=https://api.hotel.ir
   ```
3. **n8n:** در `n8n/.env` مقدار `ZARIN_API_BASE=https://api.hotel.ir` را بگذارید و `ZARIN_INTEGRATION_SECRET` را برابر `ZH_INTEGRATION_SECRET` قرار دهید. در `.env` سرور، `ZH_N8N_WEBHOOK_URL` را روی Webhook n8n تنظیم کنید. workflowها بدون تغییر کار می‌کنند.
4. **پشتیبان‌گیری:** در پنل `/_/` بخش Settings → Backups، پشتیبان روزانه را فعال کنید (محلی یا S3 سازگار، مثلاً ابرآروان). volume `pb_data` تمام داده و فایل‌ها را نگه می‌دارد.
5. **به‌روزرسانی:** `git pull && docker compose up -d --build`. migrationهای جدید هنگام شروع سرور خودکار اجرا می‌شوند.

## متغیرهای محیطی

| متغیر | توضیح |
|---|---|
| `ZH_DOMAIN` | دامنهٔ عمومی سرور (برای Caddy) |
| `ZH_INTEGRATION_SECRET` | کلید HMAC مشترک با n8n. بدون آن API نسخهٔ v1 همهٔ درخواست‌ها را رد می‌کند |
| `ZH_N8N_WEBHOOK_URL` | Webhook دریافت رویدادها در n8n. اگر خالی باشد، رویدادی ارسال نمی‌شود |
| `ZH_PUSH_VIA_N8N` | با مقدار `1`، درخواست Push برای n8n صف می‌شود تا از طریق سرویس Push دلخواه ارسال شود |
| `ZH_AI_PROVIDER` | `none` (پیش‌فرض: پاسخ قاعده‌محور از داده‌های هتل)، `anthropic`، یا `openai_compatible` (مدل self-hosted مثل Ollama یا vLLM) |
| `ZH_AI_API_KEY` / `ZH_AI_MODEL` / `ZH_AI_BASE_URL` | تنظیمات ارائه‌دهندهٔ AI |

> **نکتهٔ AI در ایران:** API شرکت Anthropic از داخل ایران در دسترس نیست. پیش‌فرض `none` است و دستیار با پاسخ‌های مستند به داده‌های خود هتل کار می‌کند. برای پاسخ‌های زبانی پیشرفته‌تر، یک مدل self-hosted را با `openai_compatible` وصل کنید.

## API

| مسیر | توضیح |
|---|---|
| `/api/collections/*` | CRUD استاندارد PocketBase، محدود به API rules |
| `GET /api/zarin/me` | پروفایل، نقش و مجوزهای محاسبه‌شده |
| `POST /api/zarin/users` · `/users/{id}/status·password·role` | مدیریت کاربران (ماتریس «چه کسی چه نقشی را می‌تواند بدهد») |
| `POST /api/zarin/sessions` · `/sessions/revoke` | ثبت دستگاه و خروج از همهٔ دستگاه‌ها |
| `POST /api/zarin/rooms/{id}/status` | تغییر وضعیت اتاق بر اساس نقش |
| `POST /api/zarin/tasks/{id}/transition` | تسک نظافت و اتاق در یک تراکنش |
| `POST /api/zarin/tickets/{id}/status·assign` | چرخهٔ تیکت تعمیرات و timeline |
| `POST /api/zarin/inventory/{id}/movements` | حرکت انبار و ledger در یک تراکنش |
| `POST /api/zarin/ai/ask` | دستیار هوشمند |
| `/v1/...` (امضای HMAC) | همان قرارداد Firebase برای n8n و IoT: `summary`، `maintenance/overdue`، `notifications`، `insights`، `energy/readings`، `metrics/rollup`، `insights/run` و `outbox/flush` |

زمان‌بندی‌ها (UTC): rollup ساعت ۲۰:۵۰ (برابر ۰۰:۲۰ تهران)، پیشنهادها ساعت ۰۳:۱۰ (برابر ۰۶:۴۰ تهران)، بررسی SLA هر ۱۵ دقیقه، و ارسال صف رویدادها هر دقیقه.
