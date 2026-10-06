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
├── scripts/              seed دمو · reset-demo · create-hotel (تعاملی) · test-server · build-core · get-pocketbase
├── test/                 ۴۷ تست روی سرور واقعی (امنیت، workflowها، API یکپارچه‌سازی، reset-demo، قوانین ورودی)
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
npm test                             # ۴۷ تست روی یک سرور موقت (Node 22.12 به بالا)
npm run test-server                  # سرور موقت seedشده، برای اجرای اپ یا تست‌های Flutter
```

اسکریپت‌های مدیریتی (`seed`، `create-hotel`، `reset-demo`) با **Node 18** هم اجرا می‌شوند و فقط به SDK نیاز دارند: `npm ci --omit=dev`. اجرای تست‌ها Node 22.12 یا جدیدتر لازم دارد (روی macOS: `brew install node@22`).

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

### لیارا (Liara)

لیارا HTTPS را خودش فراهم می‌کند، پس Caddy لازم نیست. راهنمای قدم‌به‌قدم کل استقرار، شامل n8n، پاک کردن دادهٔ دمو و چک‌لیست امنیتی، در [راهنمای لیارا](../docs/09-liara-runbook.md) آمده است.

#### روش اصلی: برنامهٔ آمادهٔ PocketBase با دیسک (one-click)

برنامهٔ `zarin-hoshmand-nieplltrhr` از ایمیج آمادهٔ لیارا (`one-click-apps/pocketbase:0.40.4`) اجرا می‌شود، نه از `Dockerfile` این پوشه. hookها و migrationهای ما روی دیسک‌های دائمی آن کپی می‌شوند:

| مسیر روی سرور | محتوا |
|---|---|
| `/usr/local/bin/pocketbase` | فایل اجرایی |
| `/pb_data` | دیتابیس و فایل‌ها (دیسک دائمی) |
| `/pb_hooks` | محتوای `pocketbase/pb_hooks` (دیسک دائمی) |
| `/pb_migrations` | محتوای `pocketbase/pb_migrations` (دیسک دائمی) |
| `/pb_public` | فایل‌های استاتیک (فعلاً استفاده نمی‌شود) |

**نصب و به‌روزرسانی.** هر بار که `pb_hooks` یا `pb_migrations` در این مخزن تغییر کند، در پنل لیارا ← برنامهٔ PocketBase ← «خط فرمان» این دستور را اجرا کنید:

```sh
B=claude/awesome-ramanujan-cvthpx
cd /tmp && rm -rf test23-* s.tgz \
  && wget -qO s.tgz "https://codeload.github.com/alireza4585/test23/tar.gz/refs/heads/$B" \
  && tar xzf s.tgz \
  && cp -r test23-*/pocketbase/pb_migrations/. /pb_migrations/ \
  && cp -r test23-*/pocketbase/pb_hooks/. /pb_hooks/ \
  && rm -rf test23-* s.tgz && echo "copied"
```

- migrationها **قبل از** hookها کپی می‌شوند. PocketBase تغییر `/pb_hooks` را خودش تشخیص می‌دهد، restart می‌شود و هنگام شروع migrationهای جدید را اجرا می‌کند. اگر ترتیب برعکس باشد، ممکن است restart پیش از رسیدن migrationها رخ دهد.
- **بررسی:** `/v1/health` باید `{"ok":true,…}` برگرداند. اگر نسخهٔ جدید migration داشت، در پنل `/_/` بررسی کنید که اعمال شده باشد. مثلاً migration `1759800000_outbox_lease` فیلد `lockedUntil` را به collection `outbox` اضافه می‌کند. اگر فیلد هنوز نبود، برنامه را از پنل لیارا یک بار «راه‌اندازی مجدد» کنید.
- اگر این شاخه بعداً در `main` ادغام شد، `B=main` بگذارید.
- `cp` فایل‌ها را اضافه یا جایگزین می‌کند ولی پاک نمی‌کند. اگر روزی فایلی از `pb_hooks` حذف شد، آن را روی سرور هم با `rm` پاک کنید.
- **`liara deploy` را روی این برنامه اجرا نکنید.** این کار ایمیج آماده را با `Dockerfile` ما جایگزین می‌کند. آن Dockerfile داده را در `/pb/pb_data` می‌خواند، نه دیسک `/pb_data`، پس برنامه با دیتابیس خالی بالا می‌آید. به همین دلیل نام برنامه در `liara.json` عمداً `change-me-new-docker-app` است.
- **طرح دیتابیس را از پنل `/_/` تغییر ندهید.** این ایمیج احتمالاً automigrate روشن دارد و هر تغییر collection در پنل، یک فایل migration تازه در `/pb_migrations` می‌سازد که با migrationهای مخزن تداخل پیدا می‌کند. تغییر طرح فقط با migration در همین مخزن انجام شود.
- **حساب مدیر سرور (superuser):** رمز را از پنل `/_/` ← Superusers عوض کنید. اگر رمز فراموش شد، در «خط فرمان» این دستور را اجرا کنید (رمز را هنگام تایپ نمایش نمی‌دهد):
  ```sh
  printf 'Email: '; read E; stty -echo; printf 'New password: '; read P; stty echo; echo
  /usr/local/bin/pocketbase superuser upsert "$E" "$P" --dir=/pb_data; unset P
  ```

#### روش جایگزین: برنامهٔ Docker با `liara deploy`

برای برنامهٔ **تازه‌ای** از نوع Docker، که ایمیج را از `Dockerfile` همین پوشه می‌سازد. تنظیمات در `pocketbase/liara.json` است: پورت ۸۰۹۰ و دیسک `pb-data` روی `/pb/pb_data`.

1. یک برنامهٔ Docker بسازید و نام آن را در فیلد `app` فایل `liara.json` بگذارید.
2. ابزار، ورود و دیسک دائمی (یک بار):
   ```bash
   npm i -g @liara/cli && liara login
   liara disk create --app <نام برنامه> --name pb-data --size 1
   ```
3. متغیرهای محیطی جدول پایین را از پنل لیارا تنظیم کنید.
4. استقرار با `cd pocketbase && liara deploy`. اگر سرور build لیارا به GitHub دسترسی نداشت، فایل `pocketbase_0.40.4_linux_amd64.zip` را با نام `pocketbase.zip` کنار `Dockerfile` بگذارید و دوباره deploy کنید.
5. superuser را با لینک `…/_/#/pbinstall/…` از `liara app logs --app <نام برنامه>` بسازید، یا با `liara app shell` و دستور `/pb/pocketbase superuser upsert … --dir=/pb/pb_data`.

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
   ```zsh
   cd pocketbase && npm ci --omit=dev
   ZH_PB_URL=https://api.hotel.ir npm run create-hotel
   ```
   اسکریپت هر مقداری را که در متغیرهای محیطی نباشد می‌پرسد (رمزها بدون نمایش روی صفحه) و همان لحظه بررسی می‌کند. پرسش‌ها به ترتیب: ایمیل و رمز superuser، نام هتل، شهر، تعداد اتاق، ستاره، نام مدیرکل، کد ملی و رمز موقت. سپس خلاصه را برای تأیید نشان می‌دهد.
   - **کد ملی:** ۱۰ رقم که رقم آخر آن رقم کنترل است، پس عدد ساختگی رد می‌شود. کد ملی‌ای که روی سرور کاربر دارد هم رد می‌شود.
   - **رمز موقت:** حداقل ۸ کاراکتر با دست‌کم یک حرف انگلیسی و یک عدد. دو بار پرسیده می‌شود.

   مدیرکل در اولین ورود رمز را عوض می‌کند و بقیهٔ کاربران را از داخل اپ می‌سازد. برای اجرای خودکار همهٔ مقادیر را با متغیرها بدهید (فهرست در بالای `scripts/create-hotel.mjs`). در این حالت چیزی پرسیده نمی‌شود.

   برای دمو به‌جای این کار `npm run seed` را اجرا کنید که هتل ۶۰ اتاقه با ۱۶ نقش می‌سازد. رمز همهٔ حساب‌های دمو (`Zarin@2026`) در همین مخزن منتشر شده است، پس پیش از استفادهٔ واقعی دادهٔ دمو را پاک کنید:
   ```zsh
   ZH_PB_URL=https://api.hotel.ir npm run reset-demo
   ```
   فهرست چیزهایی که پاک می‌شوند نمایش داده می‌شود و برای پاک کردن، تایپ `yes` لازم است (در اجرای خودکار: `-- --yes`). هتل‌های دیگر و حساب superuser دست نمی‌خورند.
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
| `ZH_PUSH_VIA_N8N` | با مقدار `1`، رویداد `push.requested` برای n8n صف می‌شود تا از طریق سرویس Push دلخواه ارسال شود. workflowهای فعلی این رویداد را مصرف نمی‌کنند، پس تا ساخت آن workflow خالی بماند |
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
