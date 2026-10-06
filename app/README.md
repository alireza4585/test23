# Zarin Hooshmand — Flutter app (Android + iOS)

Single codebase for Android 10+ and iOS 15+. Clean Architecture + feature-first,
Riverpod for state/DI, go_router with role-based guards, Material 3, Persian (RTL)
first with English.

## Run

```bash
flutter pub get

# Offline demo backend (seeded 60-room hotel, 16 demo roles) — default
flutter run

# PocketBase backend (self-hosted, see ../pocketbase)
flutter run --dart-define=ZH_BACKEND=pocketbase --dart-define=ZH_PB_URL=https://api.example.ir
# Liara server, APK build and a manual test checklist: ../docs/10-flutter-app.md

# Firebase backend
dart pub global activate flutterfire_cli
flutterfire configure --project=zarin-hoshmand --platforms=android,ios   # writes lib/firebase_options.dart
flutter run --dart-define=ZH_BACKEND=firebase

# Firebase emulators (from repo root: firebase emulators:start)
flutter run --dart-define=ZH_BACKEND=firebase --dart-define=ZH_USE_EMULATORS=true \
            --dart-define=ZH_EMULATOR_HOST=10.0.2.2   # Android emulator → host
```

Demo logins: any role chip on the login screen, or national ID + `Zarin@2026`
(see `lib/data/demo/demo_seed.dart`).

| `--dart-define` | Default | Meaning |
|---|---|---|
| `ZH_BACKEND` | `demo` | `pocketbase`, `firebase` or `demo` |
| `ZH_PB_URL` | — | PocketBase server URL (required for `pocketbase`) |
| `ZH_ENV` | `dev` | `dev` / `staging` / `prod` |
| `ZH_FUNCTIONS_REGION` | `europe-west3` | Cloud Functions region |
| `ZH_USE_EMULATORS` | `false` | Connect to the local emulator suite |
| `ZH_SESSION_TIMEOUT_MINUTES` | `30` | Idle sign-out on shared devices |

## Quality gates

```bash
flutter analyze
flutter test                                   # unit + widget (demo backend)
ZH_PB_TEST_URL=http://127.0.0.1:PORT flutter test test/pocketbase   # adapters vs live PocketBase
flutter test --update-goldens tool/screenshots_test.dart   # regenerate tool/screenshots/*.png
```

## Layout

```
lib/
├── main.dart / bootstrap.dart / app.dart   # entry, composition root, MaterialApp.router
├── core/        config · di · error · l10n · platform · preferences · routing · security · theme · utils · widgets
├── data/        backend.dart · repository_providers.dart (port → adapter binding)
│   ├── demo/        in-memory backend + seed + simulated automations + demo AI analyst
│   ├── pocketbase/  PocketBase adapters (live queries over realtime, /api/zarin commands)
│   └── firebase/    Firestore / Auth / Storage / Functions adapters
├── features/<feature>/{domain,application,presentation}
└── l10n/        app_fa.arb (template) · app_en.arb · generated/
```

Architecture, data model, security and roadmap: see [`../docs`](../docs).
