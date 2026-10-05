# زرین هوشمند · Zarin Hooshmand

**Smart Optimization Platform for Hospitality.** A platform for hotels to record their operational data, analyse it, automate the routine work and get AI suggestions.

```
ثبت داده → تحلیل → پیشنهاد AI → تصمیم مدیر → بهبود عملیات → کاهش هزینه → افزایش بهره‌وری
```

The MVP is a sellable product built so AI, IoT, sensors, a digital twin, predictive analytics and a dedicated backend can be added later without rewriting it.

| | |
|:-:|:-:|
| ![GM dashboard](app/tool/screenshots/02_gm_dashboard.png) | ![Housekeeper](app/tool/screenshots/03_housekeeper_home.png) |
| Executive dashboard (General Manager) | "My work" (housekeeper, one-tap flow) |

## Repository

```
app/        Flutter app: Android 10+ and iOS 15+. Clean Architecture, Riverpod, go_router, Material 3, RTL
pocketbase/ Self-hosted backend (recommended): schema + access rules, JS hooks, seed, Docker/Caddy deploy, tests
firebase/   Alternative managed backend: Firestore/Storage rules, Cloud Functions (TypeScript), tests
n8n/        Automation workflows (alerts → Bale/SMS/e-mail, morning briefing, SLA escalation, IoT ingestion)
docs/       Architecture and product documentation (Persian), mapped to every requested deliverable
```

The deliverables index is in **[docs/README.md](docs/README.md)**: architecture, data model and schema, roles, UI flow and journeys, wireframes, API, n8n, AI plan and roadmaps.

## Quick start: runnable demo (no backend needed)

```bash
cd app
flutter pub get
flutter run            # offline demo backend with a seeded 60-room hotel
```

Sign in by tapping a role chip on the login screen, or with a national ID and the password `Zarin@2026`:

| Role | National ID | Role | National ID |
|---|---|---|---|
| General Manager | `0012345679` | Housekeeper | `0102345678` |
| Hotel Owner | `0023456787` | Maintenance technician | `0124567894` |
| Operations Manager | `0034567895` | Reception | `0091234565` |
| Energy Manager | `0045678911` | Restaurant Manager | `0135678919` |
| Maintenance Manager | `0056789122` | Restaurant staff | `0168912341` |
| Housekeeping Manager | `0067891233` | Analyst | `0146789121` |
| Inventory Manager | `0078912342` | HR Manager | `0089123451` |
| Super Admin | `0157891232` | | |

## Backends

The app talks to repository interfaces, so the backend is a build flag (`ZH_BACKEND`):

| `ZH_BACKEND` | Backend | Use |
|---|---|---|
| `pocketbase` | **PocketBase** on your own server ([pocketbase/README.md](pocketbase/README.md)) | Recommended: runs in-country, single binary, no Google dependency |
| `firebase` | Firebase project `zarin-hoshmand` | Managed alternative |
| `demo` (default) | Offline in-memory hotel | Sales demos, UI work, widget tests |

### PocketBase (recommended)

```bash
# Server (on your VPS): Docker + automatic HTTPS
cd pocketbase/deploy && cp .env.example .env    # set ZH_DOMAIN, ZH_INTEGRATION_SECRET
docker compose up -d --build
docker compose exec pocketbase /pb/pocketbase superuser upsert admin@example.ir 'strong-password' --dir=/pb/pb_data

# First hotel + General Manager (or `npm run seed` for the demo hotel)
cd .. && npm install && ZH_PB_URL=https://api.example.ir … npm run create-hotel

# App
cd ../app && flutter run --dart-define=ZH_BACKEND=pocketbase --dart-define=ZH_PB_URL=https://api.example.ir
```

### Firebase (alternative)

```bash
npm i -g firebase-tools && firebase login
dart pub global activate flutterfire_cli
cd app && flutterfire configure --project=zarin-hoshmand --platforms=android,ios
cd ../firebase/functions && npm ci && npm run deploy
flutter run --dart-define=ZH_BACKEND=firebase
```

n8n setup is covered in [n8n/README.md](n8n/README.md).

## Quality gates

| Command | Covers |
|---|---|
| `cd app && flutter analyze && flutter test` | Lints, plus 31 unit and widget tests: RBAC, router guard, domain policies, login → one-tap cleaning flow |
| `cd pocketbase && npm test` | 42 tests against a live PocketBase: tenant isolation, role rules, transactional workflows, user admin, audit, HMAC API, rule engine |
| `ZH_PB_TEST_URL=… flutter test test/pocketbase` | 8 Flutter adapter tests against a live PocketBase (`npm run test-server`) |
| `cd firebase/functions && npm run typecheck && npm test` | TypeScript, plus 18 unit tests: RBAC drift guard against the Dart policy and the rules, analytics, rule engine |
| `npm run test:rules` | 20 Firestore Security Rules tests on the emulator (tenant isolation, forged actors, illegal transitions, ledger) |
| `npm run test:integration` | 7 end-to-end function tests against the Auth and Firestore emulators |
| `npm run gen:rules` | Regenerates the RBAC block of `firestore.rules` from `rbac.ts` |

## Architecture at a glance

- **Backend-agnostic.** Features depend on repository interfaces. Adapters are `data/pocketbase`, `data/firebase` and `data/demo`; a REST adapter for a future PostgreSQL backend is one more. Binding happens in one file.
- **Security in depth.** Role-filtered UI, a router guard (deep links included), then the server as the actual enforcement: PocketBase API rules + hooks (or Firestore Rules + Cloud Functions). Changing the UI or the route never exposes data.
- **Explainable analytics first, LLM second.** KPIs and rule-based insights are computed server-side. The LLM (behind an `LlmProvider` port, with server-side fallback) only explains and narrates.
- **Automation never breaks operations.** n8n gets HMAC-signed, fire-and-forget events. In-app alerts and push notifications come from the backend itself.

> **Iran deployment note:** Google (Firebase/FCM) and Anthropic services may be unavailable from Iran. The PocketBase backend runs on an in-country server with no Google dependency; the AI assistant defaults to data-driven answers without an external LLM and can use a self-hosted model. Push notifications on that path go through n8n to a provider of your choice (see [docs/08-roadmap.md](docs/08-roadmap.md)).
