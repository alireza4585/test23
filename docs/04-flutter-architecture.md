# ۸. معماری Flutter: ساختار پوشه‌ها، State، DI، Routing و Repository

## ساختار پوشه‌ها (Clean Architecture + Feature-first)

```
app/lib/
├── main.dart                     # فقط bootstrap() را صدا می‌زند
├── bootstrap.dart                # Composition root: config، backend، سرویس‌های پلتفرم → overrides
├── app.dart                      # MaterialApp.router، تم، locale و SessionGuard
├── firebase_options.dart         # خروجی flutterfire configure
│
├── core/                         # مشترک و بی‌اطلاع از feature
│   ├── config/                   # AppConfig (--dart-define): backend، env، region، timeout
│   ├── di/                       # appConfigProvider، backendProvider، clockProvider
│   ├── domain/                   # Actor، MediaFile (value objects مشترک)
│   ├── error/                    # sealed AppFailure (InvalidCredentials، PermissionDenied، Network …)
│   ├── l10n/                     # context.l10n، Formatters (ارقام فارسی، جلالی، پول)، enum labels
│   ├── platform/                 # SecureStore، PushService، MediaPicker، DeviceInfoService
│   ├── preferences/              # زبان و تم (shared_preferences)
│   ├── routing/                  # Routes، RouteAccess، authRedirect، RoleExperience (منوی نقش‌محور)
│   ├── security/                 # AppRole (۱۵)، AppPermission (۳۲)، RolePolicy
│   ├── theme/                    # AppColors، StatusPalette، AppTheme (dark و light)
│   ├── utils/                    # IranNationalId، DayKey، Clock، stream utils
│   └── widgets/                  # AppShell، KpiCard، ZCard، StatusPill، Charts، Feedback views
│
├── data/                         # Adapters (پیاده‌سازی portها)
│   ├── backend.dart              # sealed Backend { FirebaseBackend | DemoBackend }
│   ├── repository_providers.dart # ← تنها جایی که port به adapter وصل می‌شود
│   ├── firebase/                 # Firestore، Auth، Storage و Functions adapters
│   └── demo/                     # بک‌اند in-memory با seed هتل ۶۰ اتاقه و اتوماسیون شبیه‌سازی‌شده
│
├── features/<feature>/
│   ├── domain/                   # Entity، enum، Repository interface (port)، Policy و Workflow خالص
│   ├── application/              # Riverpod providers، Actions (use case)
│   └── presentation/             # صفحات و ویجت‌ها
│       features = auth · hotel · dashboard · rooms · housekeeping · maintenance · energy ·
│                  operations · inventory · staff · notifications · ai · reports · admin · profile
│
└── l10n/                         # app_fa.arb (template)، app_en.arb، generated/
```

**قواعد وابستگی**

```
presentation ──► application ──► domain ◄── data (adapters)
                       │                         ▲
                       └──── core ◄──────────────┘
```

- `domain` هیچ import از Flutter UI یا Firebase ندارد. شامل Dart خالص است و تست واحد دارد: `RoomStatusPolicy`، `TicketWorkflow`، `HousekeepingWorkflow`، `EnergyAnalytics`، `DashboardMetrics`.
- `presentation` فقط providerها را می‌شناسد و هیچ‌وقت مستقیم با Firestore کار نمی‌کند.
- `data/firebase` تنها جایی است که `cloud_firestore` import می‌شود.

## State Management: Riverpod 3

| نوع | استفاده | مثال |
|---|---|---|
| `Provider` | سرویس، repository، مقدار مشتق‌شده | `roomsRepositoryProvider`، `roomStatusCountsProvider` |
| `StreamProvider` | دادهٔ real-time از repository | `roomsProvider`، `todayTasksProvider`، `alertsProvider` |
| `StreamProvider.autoDispose.family` | جزئیات یک موجودیت | `roomProvider(id)`، `ticketProvider(id)` |
| `Notifier` | state محلی و تعاملی | `assistantControllerProvider`، `loginControllerProvider`، `signOutReasonProvider` |
| Actions class | use case و فرمان (write) | `RoomsActions.changeStatus`، `HousekeepingActions`، `MaintenanceActions` |

الگوی هر feature:

```dart
// domain: port
abstract interface class RoomsRepository {
  Stream<List<Room>> watchRooms(String hotelId);
  Future<void> updateStatus({required String hotelId, required RoomStatusChange change, required Actor actor, String? note});
}

// application: state + guard (UX) — the backend enforces again
final roomsProvider = StreamProvider<List<Room>>((ref) {
  final user = ref.watch(sessionUserProvider);
  if (user == null || !user.can(AppPermission.roomsView)) return Stream.value(const []);
  return ref.watch(roomsRepositoryProvider).watchRooms(user.hotelId);
});
```

UI حالت‌های `AsyncValue` (loading، error، data) را با `AsyncValueView` به‌شکل یکسان نمایش می‌دهد. خطاها `AppFailure` هستند و به پیام فارسی یا انگلیسی نگاشت می‌شوند.

## Dependency Injection

- **Composition root:** `bootstrap.dart`. config را می‌خواند، بک‌اند را مقداردهی می‌کند و پیاده‌سازی‌های واقعی را با `ProviderScope(overrides: …)` تزریق می‌کند. مقادیر تزریق‌شده: `SecureStore` (Keychain/Keystore)، `PushService` (FCM)، `Backend`، `SharedPreferences`.
- **اتصال port به adapter:** `data/repository_providers.dart`

```dart
final roomsRepositoryProvider = Provider<RoomsRepository>(
  (ref) => switch (ref.watch(backendProvider)) {
    final FirebaseBackend b => FirestoreRoomsRepository(b.firestore),
    final DemoBackend b => DemoRoomsRepository(b.store),
    // final RestBackend b => RestRoomsRepository(b.client),   ← بک‌اند اختصاصی
  },
);
```

`Backend` یک sealed class است. با افزودن `RestBackend`، کامپایلر هر switch ناقص را گزارش می‌کند، پس هیچ repositoryای فراموش نمی‌شود.

- **تست:** `ProviderScope(overrides: [...])` با `DemoBackend`، `FixedClock` و `InMemorySecureStore`. هیچ mock دستی لازم نیست.

## Repository / Service Layer

| Port (`features/*/domain`) | Firebase adapter | Demo adapter |
|---|---|---|
| `AuthRepository`، `SessionRepository` | `FirebaseAuthRepository` (ایمیل مصنوعی از کد ملی، claims و پروفایل)، `FirebaseSessionRepository` (callables) | `DemoAuthRepository` |
| `HotelRepository` | `FirestoreHotelRepository` | `DemoHotelRepository` |
| `RoomsRepository` | Transaction با `previousStatus` | ✓ |
| `HousekeepingRepository` | Transaction: تسک و اتاق | ✓ |
| `MaintenanceRepository` | آپلود عکس در Storage، سپس Batch: تیکت و event | ✓ |
| `EnergyRepository`، `OperationsRepository` | کلید idempotent روزانه | ✓ |
| `InventoryRepository` | Transaction: item، movement و `lastMovementId` | ✓ |
| `StaffRepository` | ✓ | ✓ |
| `NotificationsRepository`، `AlertsRepository`، `InsightsRepository` | ✓ | ✓ |
| `AiAssistantRepository` | `FunctionsAiAssistantRepository` (callable `aiAssistant`) | `DemoAiAssistant` (قواعد محلی) |
| `ReportsRepository` | آپلود PDF و ثبت متادیتا | ✓ |
| `UserAdminRepository` | callables `admin*` و `members` | ✓ |

Use caseهایی که چند repository را با هم هماهنگ می‌کنند در `application` یا `domain` قرار دارند. مثلاً `ReportGenerator` دادهٔ مجاز کاربر را جمع می‌کند، PDF راست‌به‌چپ با فونت Vazirmatn می‌سازد و آن را بایگانی می‌کند.

## Navigation و Routing (go_router)

- **Guard مرکزی** `authRedirect(auth, user, location)` یک تابع خالص است و تست واحد دارد:
  1. وضعیت auth هنوز مشخص نیست ← `/splash`
  2. کاربر وارد نشده ← `/login`
  3. `mustChangePassword` ← `/change-password` (و هیچ مسیر دیگری باز نمی‌شود)
  4. مسیری که مجوزش را ندارد ← `/access-denied`، حتی با تایپ مستقیم URL، deep link یا Push
- **`RouteAccess`:** نگاشت prefix مسیر به مجوزهای لازم. اولین تطابق، که خاص‌ترین است، اعمال می‌شود.
- **`ShellRoute`** برای ناوبری اصلی (`AppShell`): `NavigationBar` در موبایل، `NavigationRail` در عرض ۸۴۰ و بیشتر، و برگهٔ «بیشتر» برای مقاصد اضافه. اعلان‌ها و دستیار به‌صورت صفحهٔ کامل و خارج از shell باز می‌شوند.
- **Deep link:** فیلد `route` در هشدار، insight و Push. `SessionGuard` آن را به Router می‌دهد و Router دوباره گارد را اجرا می‌کند.
- با تغییر کاربر یا نقش (`refreshListenable`)، redirect دوباره ارزیابی می‌شود.

## نمایش مبتنی بر نقش

`HomePage` بر اساس tier کاربر تصمیم می‌گیرد چه نمایش دهد:

| Tier | صفحه | محتوا |
|---|---|---|
| executive / platform | `ExecutiveDashboard` | KPIها (اشغال، ADR، RevPAR، درآمد، انرژی، SLA)، هشدارها، پیشنهادهای AI، وضعیت اتاق‌ها، روندها |
| manager | `OperationsDashboard` | KPIهای دپارتمان، صف کار، هشدارهای مخاطب نقش |
| staff | `StaffHome` | «کار من»: تسک یا تیکت امروز با دکمهٔ یک‌لمسی، شیفت، و دکمهٔ «گزارش خرابی» |

## Offline

Firestore persistence فعال است. پرسنل در نقاط بدون Wi-Fi کار می‌کنند و نوشتن‌ها پس از اتصال همگام می‌شوند. Transactionها (مثل شروع نظافت) اتصال لازم دارند و پیام خطای شبکهٔ مناسب نشان می‌دهند.

## Localization و فرمت

- `fa` (پیش‌فرض و RTL) و `en`، با بیش از ۴۲۰ کلید ARB.
- `Formatters`:
  - ارقام فارسی.
  - جداکنندهٔ هزارگان `٬` و اعشار `٫`.
  - تاریخ جلالی (`shamsi_date`).
  - مبلغ فشرده، مثل «۸۵ میلیون» یا «۱٫۲ میلیارد».
  - درصد علامت‌دار با LRM تا در متن RTL درست نمایش داده شود.
- نمودارها حتی در RTL از چپ به راست رسم می‌شوند (محور زمان).

## تست و کیفیت

```bash
cd app
flutter analyze                       # strict-casts، strict-raw-types و lintهای اضافه
flutter test                          # ۳۱ تست: security، domain و جریان‌های ویجت (ورود، گارد، نظافت یک‌لمسی …)
flutter test --update-goldens tool/screenshots_test.dart   # تولید اسکرین‌شات‌های docs
```
