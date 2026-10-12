# 14. Zarin AI, Batch 1: forecasts, energy baselines, recommendation ledger

Status: **implemented and tested locally; not yet deployed to Liara** (deployment steps are in §8).

Batch 1 of the plan in [13-ai-architecture-and-plan.md](13-ai-architecture-and-plan.md) contains:

| Item | What it is |
|---|---|
| A1 | Recommendation Center with a closed loop |
| A2 | Forecasting |
| A3 | Energy intelligence v2 |
| A7 | Correctness fixes |

Every number below comes from code that ran in this repository. No LLM is used in Batch 1.

---

## 1. What a hotel gets

| Feature | Where | What it does |
|---|---|---|
| **Recommendation Center** | App ← Recommendations (`/insights`) | **Tabs:** Open / Decided / Closed.<br>**Decision:** accept, implement or dismiss, with a note. Accepting or implementing can optionally open **one** linked maintenance ticket.<br>**On each card:** the expected impact (current level → target) and the decision trail (who, when, note).<br>**Measured result:** filled in after the evaluation window; pending, improvement confirmed, worse, inconclusive, or not enough data.<br>**Savings:** expected savings of open items and measured savings of decided items are shown separately. Only evaluations that pass a statistical check count as measured.<br>**Auto-close:** rule insights that are no longer detected are closed automatically with that reason. |
| **Forecasts** | App ← Forecasts (`/forecasts`) and a dashboard card | **Series:** occupancy, room revenue, total revenue, electricity, water and gas.<br>**Horizon:** 28 days ahead, with an 80% range.<br>**Transparency:** each series shows the model chosen, its backtest error next to the simple benchmark, and, after a few days, the accuracy of earlier next-day forecasts.<br>**No silent guesses:** a series with stale or too little data shows the reason instead of a forecast. |
| **Energy baseline and savings** | App ← Energy → "Baseline and savings" | **Baseline:** expected use for each day's occupancy (and season, given a year of data), learned from the year before the period.<br>**Fit quality:** CV(RMSE) and NMBE against the ASHRAE Guideline 14 limit of 25%.<br>**Tracking:** expected vs actual, and the CUSUM (cumulative difference from expected).<br>**Savings or over-use:** shown with its ± uncertainty.<br>**Per occupied room:** cost and electricity carbon. The emission factor is labelled as an assumption. |
| **Smarter energy alerts** | Server | A reading alerts only when it is above what that day's occupancy and season predict (z > 2.5 **and** above the hotel's threshold, default 15%). Without a valid model (fewer than 28 days with occupancy, or CV(RMSE) > 25%) the old static-baseline rule applies. |
| **Holidays and events** | App ← Calendar (`/settings/calendar`, hotel settings permission) | Iran's fixed solar holidays are built in. The hotel enters lunar holidays (from the official calendar) and local events. Forecasts treat all of them as special days. |
| **Correctness** | — | **Day key:** "today" in the app is the Tehran day, as on the server.<br>**PDF reports:** the maintenance report lists the period's tickets under a correct status header; the housekeeping report covers every day of the period.<br>**n8n:** SLA escalation no longer repeats the same warning every 30 minutes. |

---

## 2. Where the code lives

| Layer | Files |
|---|---|
| Deterministic core (TypeScript → `pb_hooks/lib/core.js`) | `firebase/functions/src/analytics/calendar.ts` (Jalali conversion, fixed holidays), `stats.ts`, `forecast.ts`, `energy-baseline.ts`, `evaluation.ts`; `rules-engine.ts` now attaches `expectedImpact` to each draft |
| Server (PocketBase JS hooks) | `pb_hooks/lib/forecasting.js` (forecast runs, energy models, analysis), `recommendations.js` (decide, auto-close, evaluation), `intelligence.js` (app routes), changes in `analytics.js`, `ops.js` (energy alert), `admin.js`, `integration.js`, `zarin.js`, `zarin.pb.js` (routes, cron) |
| Migrations | `1760300000_ai_forecasts_recommendations.js`, `1760300100_notification_dedupe.js` |
| App (Flutter) | `features/forecast/`, `features/calendar/`, `features/energy/domain/energy_analysis.dart`, `energy_baseline.dart` (demo), `features/ai/` (ledger model, Recommendation Center, decision sheet), `data/pocketbase/pb_intelligence_repositories.dart`, `data/demo/demo_intelligence_repositories.dart`, `data/unsupported_repositories.dart` |
| n8n | `03-maintenance-sla-escalation.json` (dedupe key, SMS only after a notification was sent) |

**Offline demo backend:** the demo forecasts with the benchmark model only (same weekday last week, with its backtest) and fits a smaller energy baseline (occupancy and Friday terms). Both are computed locally from the demo data.

**Legacy Firebase backend:** these features are reported as "needs the PocketBase backend". They are not shown as empty data.

---

## 3. API

All routes check the caller, hotel membership and permission on the server.

| Route | Permission | Body / query | Response |
|---|---|---|---|
| `POST /api/zarin/insights/{id}/decide` | `ai.insights.view` + (`dashboard.executive` or `dashboard.operations`); `maintenance.report` to open a ticket | `{decision: accepted\|dismissed\|implemented, note?, ticket?: {title?, category?, priority?, room?, area?}}` | The updated `aiInsights` record. One linked ticket at most; repeating the request reuses it. Audited as `insights.decide`. Resolved insights are refused (`insight_resolved`) |
| `GET /api/zarin/energy/analysis` | `energy.view` | `hotelId, type=electricity\|water\|gas, from, to` (≤ 366 days; default: last 30 days to yesterday) | `{baseline:{valid, cvrmse, nmbe, r2, n, from, to, perOccupiedRoom, fixedPerDay}, measurement:{days:[{day, actual, expected, diff, cusum, occupied}], savings, uncertainty, significant}, kpis:{total, perOccupiedRoom, cost, costPerOccupiedRoom, carbonKg, carbonPerOccupiedRoomKg, emissionFactor:{kind:"assumption", kgPerKwh, source, isDefault}}}` |
| `POST /api/zarin/hotels/{id}/forecasts/run` | `dashboard.executive` or `hotel.settings` | — | `{series: {occupancy: "holtWinters", water: "skipped: no_data", …}}`. Audited as `forecasts.run` |
| `POST /v1/hotels/{id}/forecasts/run` | HMAC (n8n) | — | Same as above |
| `POST /v1/hotels/{id}/notifications` | HMAC (n8n) | New optional `dedupeKey` (≤ 160 chars) and `dedupeHours` (1–72, default 4) | `{recipients, skipped}`. The same key inside the window is skipped |
| `POST /api/zarin/admin/hotels/{id}/analytics` | superuser | New `forecasts: true` | Also returns the forecast summary. With `now`, it replays as of that date |

**Collections**, readable through the normal API with these list rules:
- `forecasts` and `forecastRuns`: hotel members with `dashboard.executive` or `dashboard.operations`.
- `calendarEvents`: every member may read; `hotel.settings` may write.

**Server crons (UTC):**

| Time (UTC) | Tehran | Job |
|---|---|---|
| 20:50 | 00:20 | rollup |
| 21:40 | 01:10 | **forecasts** (new) |
| 03:10 | 06:40 | insights, then **auto-close and due evaluations** (new) |
| every 15 min | — | SLA check |
| every minute | — | outbox |

**Configuration.** No new environment variable. One optional hotel setting (the `settings` JSON of `hotels`): `gridEmissionFactorKgPerKwh`.
- If it is unset, electricity carbon uses Ember's Iran grid average for 2022 (0.494 kg CO₂/kWh), shown in the app as an assumption with its source.
- Gas carbon is not computed (no factor was verified).

---

## 4. Data model changes

- **`calendarEvents`:** hotel, day, endDay, kind (publicHoliday / religious / school / localEvent / closure / other), title, note, createdBy.
- **`forecasts`:** hotel, series, day, value, lower, upper, model, runId; unique per (hotel, series, day). Each nightly run overwrites the future days. The row kept for a past day is the last forecast made before it, which is what the next-day accuracy is measured on.
- **`forecastRuns`:** one per (hotel, series):
  - ok and reason;
  - the model chosen, and the backtest scores of all three models (MAE, MAPE, MASE);
  - `live` = accuracy of earlier forecasts against actuals over the last 28 days;
  - the training range, the horizon and the interval coverage.
- **`aiInsights`:** new fields:
  - `expectedImpact` {metric, unit, baseline, expected, monthlyIrr, method, subject};
  - `evaluation`;
  - `decisionNote`, `decidedBy`, `decidedByName`, `decidedAt`;
  - `linkedTicket`, `linkedTask`;
  - `closedReason`;
  - and a new status `resolved`.
- **`notifications`:** a new `dedupeKey` field with an index.

**Evaluation methods.** Each window starts on the day after the decision.

| Method | Recommendation | Window | How it is judged |
|---|---|---|---|
| `energyBaseline` | Energy intensity | 14 days | Savings vs a baseline fitted only on days before the decision. Evaluated only if \|savings\| exceeds the 95% uncertainty |
| `durationAvg` | Checkout-clean time | 7 days | Before/after means; Welch t ≥ 2 |
| `ticketCount` | Repeat failure | 30 days | Before/after counts; difference ≥ 2 standard errors |
| `stockout` | Stock-out risk | 14 days | Did stock reach zero? |
| `oooRooms` | Out-of-order rooms | 7 days | Are the listed rooms still out of order since before the decision? |
| `occupancyGap` | Weekend gap | — | Reported as "no automatic evaluation" (seasonality dominates) |

---

## 5. Tests and results

| Suite | Result |
|---|---|
| Core unit tests (`pocketbase/test/core-analytics.test.mjs`): calendar round-trip over 3 years, holiday dates, the forecasting rules (never worse than the benchmark, follows trends, learns holiday effects, clamps ranges), baseline fit and spike removal, anomaly rule, CUSUM and savings, evaluation methods | 15 / 15 |
| PocketBase integration (`npm test`, includes the new `ai-core.test.mjs` and notification dedupe) | **77 / 77** |
| Flutter `flutter analyze` / `flutter test` (new: forecaster, baseline, holidays, JSON parsing, Tehran day, decision flow, forecasts page, calendar, access, energy section) | no issues / **44 passed** |
| Flutter adapters against a live seeded server (`ZH_PB_TEST_URL=… flutter test test/pocketbase`) | **9 / 9** (new: forecasts, energy analysis, decision, calendar, staff refused) |
| n8n end to end | 23/23 (n8n 2.35.7), 23/23 (n8n **2.26.2**, Liara's version), 18/18 (no channels configured) |
| Legacy Firebase unit tests and TypeScript type-check | 18/18, clean |

**Backtest on the Parsian Azadi test hotel** (475 rooms, 365 days to 2026-10-06; 8 rolling origins, 14 days ahead):

| Series | Chosen model | MAPE of chosen | MAPE of benchmark (same weekday last week) |
|---|---|---:|---:|
| Occupancy | Holt-Winters | 10.33% | 13.18% |
| Room revenue | Holt-Winters | 11.62% | 14.63% |
| Total revenue | Holt-Winters | 13.72% | 16.28% |
| Electricity | Holt-Winters | 10.98% | 12.49% |
| Water | Calendar regression | 9.17% | 12.32% |
| Gas | Holt-Winters | 8.81% | 10.01% |

- **Speed:** forecasting all six series plus the insight run took about 2 seconds on that hotel.
- **Energy baseline (electricity):** fitted on 333 days; CV(RMSE) 8.2%, R² 0.95, so valid.

**Effect of the new energy alerts on the test-dataset comparison.** The workbook expects 9 electricity and 12 water "spikes" in the last 30 days. It counts days above the hotel's *static* baseline + 15%. The new rule raises none on those days, and the reason was checked day by day:
- every one of those days is within about 11% of the use expected for its occupancy and season;
- none is more than 2.5 standard errors above expectation;
- the largest, +41% above the static baseline, is +9.6% above expectation.

These are the false alarms the baseline is designed to remove. The comparison report now marks these rows "≈ method differs" with this explanation. All other scenario checks are unchanged:
- ✓ 35;
- ≈ 2 (energy method);
- ✗ 1: housekeeping, a gap in the dataset itself;
- 9 manual.

---

## 6. Known limitations

- **No booking data.** Forecasts use the hotel's daily history only. They cannot see reservations already on the books, group blocks or cancellations, so sudden changes are learned only after they happen.
  - **Shocks:** in a shock (such as the 2026 disruptions noted in the research report) recent errors grow, and the forecasts' ranges and "next-day accuracy" will show it. Managers should read forecasts as estimates.
  - **What would improve them:** the Phase C input of daily rooms on the books.
- **Lunar holidays** must be entered by the hotel. Until they are, Muharram, Ramadan and the Eids are not treated as special days.
- **Energy baseline:** occupancy and season only; no weather, because the free Open-Meteo API is non-commercial and a licensed source is still to be chosen. The savings uncertainty assumes independent daily errors, which can make it optimistic.
- **Evaluations** are simple before/after or baseline comparisons. They do not prove causation, and each says so. Measured savings count only results that pass the check.
- **Insight texts** are generated in Persian only (as before); the app's labels are bilingual.
- **"Next-day accuracy"** starts empty and fills in as days pass after deployment.
- **Offline demo:** uses the benchmark model and a 45-day history, so its energy baseline section explains that history is too short. That is by design.

---

## 7. Operating cost

| Item | Cost |
|---|---|
| New infrastructure | None. Everything runs in the existing PocketBase app on Liara |
| Compute | About 2 s per hotel per night for forecasts (475-room test hotel); energy analysis about 0.1 s per request |
| LLM / API spend | None in Batch 1 |
| Storage | About 170 forecast rows per hotel per month (6 series × 28 days, overwritten), plus 6 run rows |

---

## 8. Deployment (Liara)

1. **PocketBase.** Copy the hooks and migrations with [runbook step 2](09-liara-runbook.md#۲-بهروزرسانی-hookها-و-migrationهای-pocketbase): the same `wget … && cp` command in the Liara console.
   - PocketBase restarts and runs the two new migrations. Check that collections `forecasts`, `forecastRuns` and `calendarEvents` exist in `/_/`.
2. **First forecasts.** They appear after the 01:10 Tehran cron. Or open Forecasts in the app as the general manager and tap "Recompute".
   - A hotel needs at least 5 weeks of daily operations and meter readings.
3. **Lunar holidays.** Enter the holidays of 1405–1406 in Calendar, from the official calendar.
4. **n8n.** Update workflow 03 with [runbook step 4](09-liara-runbook.md#۴-بهروزرسانی-workflowها-در-n8n), using the importer or the console fallback. Without the update, n8n keeps working but escalations repeat every 30 minutes as before.
5. **App.** Build and install the new version ([guide 10](10-flutter-app.md)). Older app versions keep working against the new server; they simply don't show the new screens.

**Rollback.** The hooks and migrations are additive.
- To roll back the server, copy the previous branch state's `pb_hooks`. The new collections and fields stay, but are unused.
- The migrations' `down` steps remove them if needed.

---

## 9. Next: Batch 2

As planned in doc 13 §11:
- **GM briefing v2:** daily, weekly and monthly, with driver attribution.
- **Opportunity engine:** one ranked list, no double counting.
- **Copilot v2:** server-side tools with provenance, through an OpenAI-compatible endpoint, with a deterministic fallback.

**Open decision for the owner:** which LLM endpoint to use, if any (Liara gateway, self-hosted, or none). Batch 2 works without one.
