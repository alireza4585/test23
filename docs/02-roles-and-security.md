# ۴. سیستم نقش‌ها و امنیت (RBAC، Security Rules، Audit، Session)

## مدل دسترسی

```
User ──(custom claims)──► role + hotelIds
role ──(Role Template)──► Permissions (۳۲ کد)
Permission ──► UI (منو، مسیر، دکمه)   ← فقط برای نمایش
Permission ──► Firestore Rules / Cloud Functions ← اجبار واقعی
```

- **یک ماتریس، سه مصرف‌کننده.** ماتریس نقش‌ها و مجوزها در `firebase/functions/src/domain/rbac.ts` تعریف شده است:
  - بلوک `permRoles()` در `firestore.rules` از روی همین فایل **تولید** می‌شود (`npm run gen:rules`).
  - اپ نسخهٔ Dart همین ماتریس را دارد (`app/lib/core/security/role_policy.dart`).
  - تست `test/unit/rbac.test.ts` هر سه را مقایسه می‌کند و اگر اختلافی باشد (drift) شکست می‌خورد.
- **Tenant isolation.** claim `hotelIds` تعیین می‌کند کاربر به کدام هتل‌ها دسترسی دارد. فقط `superAdmin` بین هتل‌ها دسترسی دارد.
- **Role Templates** در `roleTemplates/{role}` قرار دارند (فقط‌خواندنی و تولیدشده). هر هتل می‌تواند در `hotels/{id}/roleOverrides/{role}` یک نقش را **محدودتر** کند، ولی نمی‌تواند به آن دسترسی بیشتری بدهد (`RolePolicy.resolve` اشتراک دو مجموعه را می‌گیرد). در MVP این override فقط روی UI اثر دارد. اجبار آن در Rules در فاز بعدی برنامه‌ریزی شده است.

## ۱۵ نقش

| کد | نقش | رده (Tier) | داشبورد پیش‌فرض | منوی اصلی موبایل |
|---|---|---|---|---|
| `superAdmin` | سوپر ادمین پلتفرم | platform | Executive (همهٔ هتل‌ها) | خانه · کاربران · بینش‌ها · گزارش‌ها |
| `hotelOwner` | مالک هتل | executive | Executive | خانه · بینش‌ها · گزارش‌ها · انرژی |
| `generalManager` | مدیر کل | executive | Executive (همهٔ KPIها) | خانه · اتاق‌ها · تعمیرات · انرژی |
| `analyst` | تحلیلگر داده | executive | Executive (فقط‌خواندنی) | خانه · گزارش‌ها · انرژی · دستیار |
| `operationsManager` | مدیر عملیات | manager | Operations | خانه · اتاق‌ها · خانه‌داری · تعمیرات |
| `energyManager` | مدیر انرژی | manager | Operations (تمرکز بر انرژی) | خانه · انرژی · تعمیرات · بینش‌ها |
| `maintenanceManager` | مدیر تعمیرات | manager | Operations (تمرکز بر تیکت‌ها) | خانه · تعمیرات · اتاق‌ها · انبار |
| `housekeepingManager` | مدیر خانه‌داری | manager | Operations (تمرکز بر اتاق‌ها) | خانه · خانه‌داری · اتاق‌ها · انبار |
| `restaurantManager` | مدیر رستوران | manager | Operations | خانه · انبار · پرسنل · تعمیرات |
| `inventoryManager` | مدیر انبار | manager | Operations (تمرکز بر موجودی) | خانه · انبار · گزارش‌ها · تعمیرات |
| `hrManager` | مدیر منابع انسانی | manager | Operations (پرسنل) | خانه · پرسنل · کاربران · گزارش‌ها |
| `receptionStaff` | پرسنل پذیرش | staff | «کار من» | خانه · اتاق‌ها · ثبت روزانه · تعمیرات |
| `housekeepingStaff` | مستخدم / خانه‌دار | staff | «کار من» (فقط تسک‌های خودش) | خانه · خانه‌داری · اتاق‌ها · تعمیرات |
| `maintenanceStaff` | تکنسین تعمیرات | staff | «کار من» (تیکت‌های خودش) | خانه · تعمیرات · اتاق‌ها · شیفت |
| `restaurantStaff` | پرسنل رستوران | staff | «کار من» | خانه · تعمیرات · انبار · شیفت |

منو از **مجوزها** ساخته می‌شود و نقش فقط ترتیب آن را تعیین می‌کند (`core/routing/navigation.dart`). موارد بیشتر در برگهٔ «بیشتر» نمایش داده می‌شوند.

## ماتریس مجوزها

راهنما: SA=سوپرادمین، OWN=مالک، GM=مدیرکل، OPS=عملیات، ENG=انرژی، MNT=مدیر تعمیرات، HKM=مدیر خانه‌داری، RST=مدیر رستوران، INV=انبار، HR=منابع انسانی، rcp=پذیرش، hk=مستخدم، mnt=تکنسین، rst=پرسنل رستوران، ANL=تحلیلگر.

| Permission | SA | OWN | GM | OPS | ENG | MNT | HKM | RST | INV | HR | rcp | hk | mnt | rst | ANL |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `dashboard.executive` | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  | ● |
| `dashboard.operations` | ● |  | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  |  |
| `rooms.view` | ● | ● | ● | ● | ● | ● | ● |  |  |  | ● | ● | ● |  | ● |
| `rooms.updateStatus` | ● |  | ● | ● |  | ● | ● |  |  |  | ● | ● |  |  |  |
| `rooms.manage` | ● |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |
| `housekeeping.viewOwn` | ● |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `housekeeping.viewAll` | ● | ● | ● | ● |  |  | ● |  |  |  |  |  |  |  | ● |
| `housekeeping.assign` | ● |  | ● | ● |  |  | ● |  |  |  |  |  |  |  |  |
| `housekeeping.complete` | ● |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |
| `maintenance.report` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `maintenance.viewOwn` | ● |  |  |  |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `maintenance.viewAll` | ● | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |  | ● |
| `maintenance.manage` | ● |  | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |
| `maintenance.work` | ● |  |  |  |  | ● |  |  |  |  |  |  | ● |  |  |
| `energy.view` | ● | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |  | ● |
| `energy.record` | ● |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |
| `inventory.view` | ● | ● | ● | ● |  | ● | ● | ● | ● |  |  |  |  | ● | ● |
| `inventory.move` | ● |  | ● |  |  | ● | ● | ● | ● |  |  |  |  |  |  |
| `inventory.manage` | ● |  | ● |  |  |  |  |  | ● |  |  |  |  |  |  |
| `staff.viewOwnShifts` | ● |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● |  |
| `staff.view` | ● | ● | ● | ● |  | ● | ● | ● |  | ● |  |  |  |  | ● |
| `staff.manage` | ● |  | ● | ● |  |  |  |  |  | ● |  |  |  |  |  |
| `operations.recordDaily` | ● |  | ● | ● |  |  |  |  |  |  | ● |  |  |  |  |
| `finance.view` | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  | ● |
| `reports.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  | ● |
| `reports.generate` | ● | ● | ● | ● | ● | ● |  |  | ● |  |  |  |  |  | ● |
| `notifications.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `ai.insights.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  |  | ● |
| `ai.assistant.use` | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |  |  | ● |
| `users.manage` | ● | ● | ● |  |  |  |  |  |  | ● |  |  |  |  |  |
| `audit.view` | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `hotel.settings` | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |

**نقش‌هایی که هر نقش می‌تواند تعریف کند** (جلوگیری از Privilege Escalation):
- `superAdmin`: همهٔ نقش‌ها.
- `hotelOwner`: همه به جز superAdmin و hotelOwner.
- `generalManager`: همه به جز superAdmin، hotelOwner و generalManager.
- `hrManager`: فقط چهار نقش پرسنلی.

هیچ کاربری نمی‌تواند نقش خودش را تغییر دهد یا حساب خودش را غیرفعال کند.

## ورود با کد ملی

1. ادمین (یا مدیر مجاز) کاربر را با **کد ملی، نام، نقش و رمز موقت** از طریق `adminCreateUser` تعریف می‌کند. ثبت‌نام عمومی وجود ندارد.
2. کد ملی با الگوریتم checksum اعتبارسنجی و نرمال می‌شود (ارقام فارسی و عربی به لاتین). سپس به ایمیل مصنوعی `‎<nationalId>@id.zarinhooshmand.app` نگاشت می‌شود. کاربر هیچ‌وقت ایمیل نمی‌بیند.
3. Cloud Function claimهای `{role, hotelIds, v}` را تنظیم می‌کند و پروفایل `users/{uid}` را می‌سازد (`mustChangePassword: true`). دفترچهٔ کاربران هتل هم در `hotels/{h}/members` ثبت می‌شود.
4. اولین ورود کاربر را به صفحهٔ **تغییر رمز اجباری** می‌برد. Router تا زمانی که رمز عوض نشود اجازهٔ رفتن به هیچ صفحه‌ای را نمی‌دهد.
5. خطاها به پیام‌های امن نگاشت می‌شوند: «کد ملی یا رمز اشتباه»، «حساب غیرفعال»، «تلاش زیاد». پیام‌ها نشان نمی‌دهند که حسابی با این کد ملی وجود دارد یا نه.
6. در لیست‌ها کد ملی **ماسک‌شده** نمایش داده می‌شود (`001•••••79`). کد کامل فقط در پروفایل خود کاربر خوانده می‌شود.

## دفاع چندلایه: «تغییر UI یا Route کافی نیست»

| لایه | کار | فایل |
|---|---|---|
| ۱. منو | فقط مقاصد مجاز نمایش داده می‌شوند | `navigation.dart` |
| ۲. Router guard | هر `location`، از جمله deep link و Push، با `RouteAccess` بررسی می‌شود و در صورت عدم مجوز به `/access-denied` می‌رود | `app_router.dart`، `routes.dart` |
| ۳. Repository | کوئری‌ها فقط دادهٔ مجاز را درخواست می‌کنند. مثلاً مستخدم فقط `assigneeId == uid` | `data/firebase/*` |
| ۴. **Firestore Rules** | هر خواندن و نوشتن با claim و ماتریس بررسی می‌شود. اپ دستکاری‌شده یا REST مستقیم هم رد می‌شود | `firebase/firestore.rules` |
| ۵. **Cloud Functions** | callableها `requireCaller` → `requireHotel` → `requirePermission` را صدا می‌زنند. ورودی‌ها با Zod اعتبارسنجی می‌شوند | `lib/guards.ts` |
| ۶. Storage Rules | عکس خرابی فقط برای اعضای هتل (تصویر، کمتر از ۸MB) و PDF گزارش فقط برای `reports.view` | `firebase/storage.rules` |

## اجرا در بک‌اند PocketBase

دفاع چندلایه در PocketBase هم برقرار است. لایه‌های ۴ و ۵ جدول بالا در PocketBase این‌ها هستند:

- **API rules:** ایزوله‌سازی با `@request.auth.hotels.id ?= hotel` و مجوز با `@request.auth.permissions.code ?= '…'`. مجوزها را سرور از قالب نقش محاسبه می‌کند.
- **hookها و routeهای تراکنشی:** انتقال وضعیت بر اساس نقش، whitelist فیلدها، پر کردن actor توسط سرور، و ممنوعیت ارجاع به رکورد هتل دیگر.

۴۲ تست روی سرور واقعی همهٔ موارد این بخش را بررسی می‌کنند ([`pocketbase/test`](../pocketbase/test)). جزئیات در [`pocketbase/README.md`](../pocketbase/README.md#امنیت-در-pocketbase) است.

## نکات کلیدی Security Rules

- **انتقال وضعیت اتاق بر اساس نقش** (`roomTransitions()`). مستخدم فقط می‌تواند `vacantDirty → cleaningInProgress → vacantClean` را انجام دهد. پذیرش فقط `vacantClean → occupied → vacantDirty`. فیلد `previousStatus` باید با وضعیت فعلی برابر باشد، که مانع race condition و جعل می‌شود.
- **تسک‌ها.** مستخدم فقط تسک خودش را می‌بیند و فقط `pending→inProgress` و `inProgress→done` را انجام می‌دهد. `startedAt` و `completedAt` باید برابر `request.time` باشند، پس زمان جعلی پذیرفته نمی‌شود.
- **تیکت‌ها.** گزارش‌دهنده باید خود کاربر باشد. اولویت، دسته و تعداد عکس (حداکثر ۶) اعتبارسنجی می‌شوند و گزارش‌دهنده نمی‌تواند خودش تیکت را assign کند. تکنسین فقط روی تیکت خودش و فقط با انتقال‌های مجاز کار می‌کند. Timeline (`events`) **تغییرناپذیر** است.
- **انبار.** `quantity` فقط وقتی تغییر می‌کند که یک **سند حرکت** در همان تراکنش وجود داشته باشد و `quantityBefore` و `quantityAfter` را توضیح دهد. این با `getAfter` بررسی می‌شود. حرکات انبار تغییرناپذیرند.
- **Actor stamp.** فیلدهای `createdBy`، `updatedBy`، `recordedBy` و `actor` باید `uid` خود کاربر باشند.
- **مجموعه‌های فقط-سرور.** `alerts`، `aiInsights`، `notifications`، `dailyMetrics`، `auditLogs`، `members`، `aiConversations` و `usage` را کلاینت نمی‌تواند ایجاد کند. فقط تغییر محدود مجاز است، مثلاً acknowledge کردن هشدار یا تغییر وضعیت یک insight.
- **تست‌ها.** ۲۰ تست rules روی emulator اجرا می‌شوند، از جمله: دسترسی بین هتل‌ها، جعل actor، دسترسی مستخدم به تسک دیگران، انتقال غیرمجاز اتاق، دستکاری موجودی بدون ledger و نوشتن در auditLogs.

## Audit Log

- trigger `auditHotelWrites` (`onDocumentWrittenWithAuthContext`) هر create، update و delete زیر `hotels/{h}/…` را با **actor، diff فیلدها و منبع** (client، function، n8n یا iot) در `hotels/{h}/auditLogs` ثبت می‌کند.
- عملیات مدیریتی (ایجاد کاربر، تغییر نقش، غیرفعال‌سازی، بازنشانی رمز، ابطال نشست) جداگانه و با جزئیات ثبت می‌شوند.
- Audit log فقط توسط نقش‌های دارای `audit.view` (مالک و مدیرکل) خوانده می‌شود و هیچ‌کس نمی‌تواند آن را تغییر دهد یا حذف کند.

## مدیریت نشست (Session Management)

| قابلیت | پیاده‌سازی |
|---|---|
| ثبت دستگاه | `authRegisterSession` پس از ورود، `users/{uid}/sessions/{deviceId}` را می‌سازد (پلتفرم، مدل، نسخهٔ اپ، push token) |
| Idle timeout | `SessionGuard` پس از ۳۰ دقیقه بی‌فعالیتی (قابل تنظیم برای هر هتل و `ZH_SESSION_TIMEOUT_MINUTES`) کاربر را خارج می‌کند. مناسب دستگاه‌های مشترک پرسنل |
| خروج از همهٔ دستگاه‌ها | `authRevokeSessions`: `revokeRefreshTokens` و علامت‌گذاری همهٔ نشست‌ها |
| ابطال خودکار | غیرفعال‌سازی کاربر، تغییر نقش یا بازنشانی رمز همهٔ توکن‌ها را باطل می‌کند. claim جدید هم در ورود بعدی اعمال می‌شود |
| خروج | push token دستگاه حذف می‌شود تا Push به دستگاه قبلی نرسد |

## داده‌های حساس (PII)

- کد ملی کامل فقط در `users/{uid}` قرار دارد که فقط خود کاربر و سوپرادمین آن را می‌خوانند. همه جای دیگر نسخهٔ ماسک‌شده است.
- کلیدهای API (LLM و سکرت یکپارچه‌سازی) فقط در Secret Manager هستند و هیچ کلیدی در اپ وجود ندارد.
- به LLM فقط **دادهٔ تجمیعی هتل** (KPI، شمارش‌ها، نام اقلام) ارسال می‌شود، نه اطلاعات هویتی پرسنل.
- Android: `allowBackup=false`. iOS: Keychain با `first_unlock_this_device` (به بکاپ iCloud منتقل نمی‌شود).
