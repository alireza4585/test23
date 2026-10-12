# 13. Zarin AI: project audit, target architecture and phased plan

Status: **Batch 1 implemented** (A1 recommendation ledger, A2 forecasting, A3 energy baselines, A7 fixes); see [14-ai-batch1.md](14-ai-batch1.md). Batches 2+ remain proposals. Research evidence behind the choices is in [12-ai-research-report.md](12-ai-research-report.md); claims about other companies or products are cited there, not here.

---

## 1. Summary

Zarin Hoshmand already has the skeleton of a decision-support platform:
- a multi-tenant data model with server-enforced RBAC;
- a deterministic metrics and rule engine with six insight rules and four alert types;
- an outbox to n8n;
- an LLM assistant with a rule-based fallback.

What it lacks:
- **forecasts and baselines** that account for occupancy and season;
- **a closed loop** that turns an insight into an approved action and then measures whether it worked;
- **a copilot that can look things up** instead of reading one fixed 14-day snapshot;
- **several data domains**: reservations, guests, POS, budgets and equipment.

The proposal is to grow the existing system rather than add a parallel "AI platform". The design rests on four parts:
- **One deterministic analytics core**, written in TypeScript and bundled into PocketBase like today. It computes every number and forecast.
- **One ledger of recommendations and actions**, with human approval and impact tracking.
- **One copilot.** The LLM explains, summarises and calls read-only tools. It never computes money and never writes data directly.
- **n8n for delivery and scheduling only.**

The ten "agents" in the brief become domain modules of that core and share its data and ranking. They are not ten autonomous LLM agents. The research shows two things behind this choice:
- **Data:** most of the value can be built from the data Zarin already has.
- **LLM access:** the large Western LLM APIs do not serve Iran. So every feature must work, with less polish, when no LLM is configured.

---

## 2. Audit of the existing project

### 2.1 What exists and works

| Area | State | Evidence |
|---|---|---|
| Backend | PocketBase 0.40.4 on Liara with 26 collections. Hotel-scoped API rules use a permission relation that clients cannot edit. Custom routes check caller, hotel and permission. 51 integration tests pass | `pocketbase/pb_migrations/1759700000_zarin_schema.js`, `pb_hooks/lib/zarin.js`, `pocketbase/test/` |
| RBAC | 15 roles and 32 permission codes. One TypeScript source is bundled into the server; a Dart mirror is guarded by a drift test | `firebase/functions/src/domain/rbac.ts`, `app/lib/core/security/role_policy.dart` |
| Metrics | `computeDailyMetrics`: occupancy, ADR, RevPAR, revenue, energy and cost, intensity, maintenance backlog, housekeeping durations, stock. Written nightly to `dailyMetrics` | `firebase/functions/src/analytics/metrics.ts`, `pb_hooks/lib/analytics.js` |
| Insight rules | Six rules: energy intensity, stock-out, housekeeping efficiency, repeat failure, out-of-order revenue, weekday occupancy gap. Results are upserted into `aiInsights` with a status lifecycle (active / accepted / dismissed / implemented) | `analytics/rules-engine.ts` |
| Alerts | Four types: energy spike (static baseline + 15%), critical ticket, low stock, SLA. Each has a dedupe key, audience roles, an inbox entry and an outbox event | `pb_hooks/lib/ops.js`, `zarin.js` `raiseAlert` |
| Assistant | `POST /api/zarin/ai/ask`. Providers: `none`, `anthropic` or `openai_compatible`. Grounded on a fixed JSON snapshot. 30 questions per user per hour. Every conversation is logged. Persian and English rule-based fallback | `pb_hooks/lib/ai.js` |
| Integration | HMAC-signed `/v1` API (summary, overdue, notifications, external insights, meter readings, rollup, insight run) and an at-least-once outbox | `pb_hooks/lib/integration.js` |
| n8n | Four workflows: event router, daily briefing, SLA escalation, smart-meter ingestion. Tested end to end on n8n 2.26.2 and 2.35.7 | `n8n/workflows/`, `n8n/test/e2e.mjs` |
| Flutter | 14 feature modules on Android and iOS. Role-ordered navigation, fa/en (429 keys), Jalali dates, fl_chart charts, on-device PDF reports, demo backend. No placeholder screens | `app/lib/features/` |
| Test data | Parsian Azadi dataset (475 rooms): 365 days of operations and energy, about 3,900 tickets, 12,000 tasks, 10,500 stock movements. The importer compares results with the workbook's scenarios (37/38 match) | `pocketbase/scripts/import-dataset.mjs`, `docs/11` |

### 2.2 Gaps that matter for AI

**Data the platform does not have:**
- reservations, arrivals and departures, on-the-books and pickup;
- guest profiles, reviews and feedback;
- POS sales, covers and recipes;
- budgets, GL and payroll;
- an equipment register and preventive-maintenance plans;
- sensor or BMS time series;
- weather;
- a holiday and event calendar (only the Thursday/Friday weekend is hard-coded).

**Analytics limits:**
- **Fixed thresholds:** anomaly detection compares against a static per-hotel baseline, with no correction for occupancy or season.
- **No forecasting** at all.
- **No measurement:** an insight's status is recorded, but its effect never is.
- **Stale insights:** an insight stays "active" after its condition disappears.
- **Persian only:** insight texts are hard-coded in Persian.
- **`dailyMetrics` is written but never read.** The dashboard, the assistant and `/v1/summary` all recompute from raw rows. The open tickets, stock and room snapshot fields hold values "as of the rollup", so back-filled history is not a true time series.

**Assistant limits:**
- A single blocking call with a fixed context: no tools, no drill-down, no provenance.
- `max_tokens` defaults to 16,000 for answers meant to be under 220 words.

**Client limits:**
- KPIs and reports are recomputed on the device from capped live streams, for example 200 newest tickets.
- `PbLive` re-fetches whole lists on every change, which costs a lot on a 475-room board.
- Day keys use device time, while the server uses fixed Tehran time.

**Operations:**
- No CI.
- n8n SLA escalation re-notifies the same tickets every 30 minutes.
- `insight.created` and `push.requested` events have no consumer.

### 2.3 Inconsistencies found (not yet fixed unless noted)

- Docs 01, 02, 04, 06 and 07 still describe Firebase and Cloud Functions as the primary backend. PocketBase replaced it.
- PDF reports:
  - the maintenance table shows ticket status under a "category" header;
  - the housekeeping report ignores the selected period;
  - the maintenance and inventory reports are not filtered to the period.
- Unused configuration:
  - `ZH_ENABLE_AI_ASSISTANT` is never read;
  - the hotel setting `sessionTimeoutMinutes` is never applied.
- Insight source `external` is shown as "rule engine" in the app.

### 2.4 Fixed during the audit

`firebase/functions/.gitignore` ignored `lib/`, which also matched `src/lib/`. As a result, seven TypeScript source files were never committed: `admin`, `alerts`, `audit`, `guards`, `n8n`, `notify`, `signature`. A fresh clone could not build the legacy functions or run their unit tests.
- **Fix:** the pattern is now `/lib/` and the files are tracked.
- **Check:** `tsc --noEmit` passes. The PocketBase `core.js` build was never affected.

---

## 3. Design principles

1. **Deterministic first.** Numbers, forecasts, money and thresholds come from validated formulas in the analytics core and are unit-tested. The LLM only explains, summarises, classifies and chooses tools.
2. **Works without an LLM.** Every feature has a deterministic output. The LLM adds narrative. With `ZH_AI_PROVIDER=none` the product stays fully usable.
3. **Provenance on every figure.** Each number shown carries one of four kinds:

   | Kind | Example |
   |---|---|
   | `fact` | a stored record |
   | `metric` | computed from facts by a named formula |
   | `forecast` | a model output, with its accuracy and interval |
   | `assumption` | a hotel setting or a scenario input |

   The copilot must keep these labels.
4. **Human in the loop for anything consequential.**
   - **No approval needed:** the system may create proposals, notify people and open low-risk tasks.
   - **Approval needed:** price changes, purchases, staffing changes and anything that costs money require a role-holder's approval. Every approval is audited and has limits.
5. **No double counting.** Findings from different modules that describe one problem share an opportunity key. Only the opportunity is ranked and counted.
6. **Measure, then claim.** Each recommendation records its expected effect and an evaluation method. "Realised savings" are shown only from a defensible comparison against a baseline.
7. **Grow the existing modules.** New logic lives in `analytics/` and is bundled by `build:core`. New collections come through migrations. Existing routes, collections and screens keep their contracts.
8. **The simplest thing that works.** No multi-agent framework, no vector database, no Python service until a feature measurably needs one.

---

## 4. Target architecture

```
                   ┌──────────────────────── Flutter app (Android / iOS) ────────────────────────┐
                   │ Executive AI dashboard · department views · Recommendation Center ·          │
                   │ Copilot · Scenario planner · Forecasts                                       │
                   └───────────────▲────────────────────────────────────────────────▲─────────────┘
                                   │ PocketBase API (RBAC enforced on server)        │ realtime
┌──────────────────────────────────┴────────────────────────────────────────────────┴──────────────┐
│ PocketBase (Liara)                                                                                │
│                                                                                                   │
│  Data layer       existing collections + forecasts · forecastRuns · calendarEvents ·              │
│                   aiInsights (extended = recommendations) · aiActions · scenarios ·               │
│                   later: budgets · assets · guestFeedback · bookingsDaily                         │
│                                                                                                   │
│  Zarin AI Core    analytics core (TypeScript → core.js, deterministic, unit-tested)               │
│                   ├─ metrics (existing) · baselines & M&V · anomaly detection                     │
│                   ├─ forecasting (seasonal naive / Holt-Winters / calendar regression,            │
│                   │   chosen per series by rolling backtest)                                      │
│                   ├─ domain modules: GM briefing · energy · maintenance · housekeeping ·          │
│                   │   inventory/F&B · workforce · finance · revenue (when data exists)            │
│                   ├─ opportunity engine (rank by IRR impact × urgency × confidence; dedupe)       │
│                   └─ scenario engine (driver-based what-if = "digital twin" v1)                   │
│                                                                                                   │
│  Orchestration    crons (rollup, forecasts, insights, evaluation) · action executor               │
│                   (approved actions only; idempotent; limits) · audit log                         │
│                                                                                                   │
│  Copilot          ai.js: tool-calling loop over read-only tools that call the core;               │
│                   provenance-tagged answers; deterministic fallback when no LLM                   │
└───────────────┬────────────────────────────────────────────┬──────────────────────────────────────┘
        outbox (HMAC)                                  /v1 API (HMAC)
                ▼                                            ▲
┌─────────── n8n (Liara) ───────────┐            ┌──── LLM endpoint (optional) ─────┐
│ alert & approval notifications    │            │ OpenAI-compatible: Liara AI       │
│ daily / weekly / monthly briefings│            │ gateway, or self-hosted vLLM /    │
│ SLA escalation (deduplicated)     │            │ Ollama on an Iranian GPU          │
│ meter / PMS / POS ingestion       │            └───────────────────────────────────┘
└───────────────────────────────────┘
```

### 4.1 Data layer: new and extended collections

All new collections:
- are hotel-scoped, with a `hotel` relation that cascades on delete;
- have `created` and `updated` autodate fields;
- reuse the existing rule kit (`member` / `perm` / `can`);
- are written only by the server unless stated.

| Collection | Purpose | Key fields | Phase |
|---|---|---|---|
| `calendarEvents` | Holidays and events that drive demand and staffing | day, endDay, kind (publicHoliday / religious / school / local event / closure), title, impactHint, source (seed / manual / import) | A |
| `forecasts` | One row per hotel, series, target day and run | series (occupancy, roomRevenue, totalRevenue, electricity, water, gas, …), day, value, lower, upper, model, runId | A |
| `forecastRuns` | Model choice and backtest accuracy per series | series, model, trainedFrom/To, horizon, metrics {MAE, MAPE, MASE vs seasonal naive}, baselineMetrics, chosen, notes | A |
| `aiInsights` (extended) | The recommendation ledger. Existing fields are kept | plus opportunityKey, expectedImpact {metric, unit, baseline, expected, monthlyIrr, method}, effort, risk, evidenceKinds, validUntil, decision {by, at, note}, linked task / ticket, evaluation {status, window, actual, delta, confidence, limitations}, locale texts | A |
| `aiActions` | Proposed or executed operational actions | kind (createTicket / createTask / notify / adjustSetting …), payload, proposedBy (rule / copilot / user), recommendation, status (proposed / approved / rejected / executed / failed / rolledBack), approvals, idempotencyKey, limits check, result, rollback | C (the ledger itself in A) |
| `scenarios` | Saved what-if scenarios | name, baseWindow, assumptions {occupancyPct, adrPct, tariffPct, labourPct, roomsOffline, wasteReductionPct, …}, result snapshot, createdBy | B |
| `budgets` | Monthly budget lines | month, department, account (USALI-style), amount, currency | B |
| `assets` | Equipment register | code, name, category, location / room, installDate, criticality, ppmIntervalDays, lastServiceAt | B |
| `guestFeedback` | Complaints, survey answers, imported reviews | channel, text, language, rating, room, department, category, sentiment, status, ticket link, consent / retention date | C |
| `bookingsDaily` | Minimum on-the-books feed (rooms booked for the next N nights as of each day), entered manually or from a PMS | asOf, stayDay, roomsBooked, revenueBooked, source | C |

Changes to existing data:
- **Rollup snapshot fields:** the "as of rollup" fields in `dailyMetrics` get explicit `asOf` stamps. Consumers will read `dailyMetrics` instead of recomputing.
- **Ticket fields:** tickets get optional `assetId` and `cost` fields, so maintenance cost is structured instead of free text.

### 4.2 Mapping the requested agents to modules

| Agent in the brief | Implemented as | Data readiness today | Phase |
|---|---|---|---|
| Hotel GM AI | Briefing module: KPI deltas with driver attribution (RevPAR = occupancy × ADR; energy change = occupancy effect vs intensity effect), top opportunities, overdue items, status of earlier recommendations. Deterministic content; the LLM narrates it | ✅ | A |
| Smart Energy & Sustainability | Occupancy-normalised baseline regression with ASHRAE Guideline 14 statistics, anomaly detection, CUSUM tracking of savings, cost and carbon per occupied room | ✅ daily meters + occupancy. Weather would improve it (licence check needed) | A |
| Predictive Maintenance | Ticket analytics first: Pareto, repair time, repeat failures, SLA risk, cost of delay from out-of-order rooms. Risk scoring per asset only once an asset register and enough failure history exist | ⚠️ tickets only; equipment ID exists in the dataset but not in the schema | A (analytics) / B (assets) |
| Housekeeping & Room Readiness | Workload balance and cleaning-time standards from tasks. Readiness-risk ranking once arrivals exist | ⚠️ no arrivals feed | B |
| Food, Beverage & Inventory | Consumption forecast per item from occupancy, reorder point with safety stock, waste ratio, shrinkage anomalies in the ledger | ✅ ledger. ❌ POS and recipes | B |
| Workforce Intelligence | Staff hours per occupied room, forecast-driven staffing need per department, overtime and absence patterns. No individual scoring | ⚠️ shifts without hours or wages | B |
| Financial Intelligence | Departmental revenue and known costs (energy, maintenance, stock), budget vs actual, inflation-adjusted comparisons | ⚠️ no budgets or GL | B |
| Operations Optimization | Cross-department bottlenecks: SLA breaches by category and shift, task queue age, room out-of-order time, handoff delays between housekeeping and maintenance | ✅ | B |
| Guest Experience | Feedback capture by staff or import, LLM classification by department, category and sentiment with deterministic validation, service-recovery deadlines, staff translation | ❌ no feedback data yet | C |
| Revenue Intelligence | Occupancy and revenue forecasts now (A). A rate adviser below the approved tariff cap, with approval, once on-the-books data exists | ⚠️ forecasts only | A (forecast) / C (advice) |

### 4.3 Copilot design

- **Loop:** the tool-calling loop runs on the server inside `ai.js`.
  - **Tool format:** the OpenAI-compatible format, which the Liara gateway and vLLM both accept. The Anthropic Messages format is kept for deployments outside Iran.
  - **Limits:** at most 4 tool rounds per question, and a short `max_tokens`.
- **Tools** (read-only, permission-checked with the caller's own role):
  - `get_kpis(range)`
  - `compare_periods(a, b)`
  - `get_forecast(series, days)`
  - `list_opportunities(category?)`
  - `explain_energy(range)`
  - `maintenance_overview(range)`
  - `get_records(collection, ids)` (records the caller may read)
  - `run_scenario(assumptions)`
- **Tool results** carry provenance kinds and deep-link routes. The app renders the figures, the sources and links to the records.
- **Untrusted text:** guest text, reviews and documents go in only as quoted data, never as instructions. The model holds no credentials, and tools validate every argument against schemas.
- **No direct writes:** the copilot cannot write. It can draft an `aiActions` proposal, and a human approves it.
- **No-LLM mode:** `ZH_AI_PROVIDER=none` maps the question to the same tools by intent and answers with templates. This replaces today's keyword fallback.

### 4.4 Opportunity engine

Every module emits findings with:
- an opportunity key, for example `energy:electricity:intensity`;
- expected monthly impact in IRR, with its method;
- urgency, confidence, effort and risk.

The engine then:
- merges findings that share a key;
- ranks by expected value adjusted for confidence, with urgency as a tiebreaker;
- writes the top items to `aiInsights`.

Insights whose condition has cleared are closed automatically, with a reason. This feeds the GM briefing and the Recommendation Center.

### 4.5 Closed-loop evaluation

When a recommendation is approved or implemented:
1. The evaluator stores the baseline window.
2. After the evaluation window, it computes the observed change with the method fixed when the recommendation was created:
   - energy: a regression baseline (IPMVP Option C style);
   - SLA and repair time: before vs after with the same day-of-week mix;
   - stock: waste ratio over time.
3. It stores the result with its confidence and limitations.

Results that are not significant are reported as "inconclusive", not as savings. The realised-savings totals on the dashboard sum only evaluations that passed.

### 4.6 Scenario engine ("digital twin" v1)

A deterministic driver-based model of one month for the hotel. Inputs come from the last N days of actuals plus hotel settings:
- rooms, occupancy and ADR;
- energy regression coefficients and tariffs;
- staff hours per occupied room and labour cost (when entered);
- stock consumption per occupied room;
- waste ratio.

Users change the drivers, for example occupancy +15%, tariff +20%, labour +10%, a floor offline, housekeeping capacity −20% or waste −30%. The engine returns:
- revenue, energy use and cost, labour hours and cost, and stock spend;
- the capacity check (rooms that can be cleaned per day against expected departures);
- the contribution, with every line labelled as simulated.

Monte Carlo ranges come later, once forecast intervals exist. A building-physics twin is out of scope until BMS data exists.

---

## 5. Where each part runs: n8n, custom code or LLM

| Capability | n8n | Custom code (PocketBase / analytics core) | LLM |
|---|---|---|---|
| KPIs, baselines, forecasts, M&V, scenario math, ranking | — | ✅ all calculations | — |
| Insight and alert generation | — | ✅ rules and statistics | optional wording |
| Recommendation ledger, approvals, action execution, limits, idempotency | — | ✅ (needs auth, transactions, audit) | — |
| Notifications to Bale / SMS / e-mail, deep links to approvals | ✅ | emits events | — |
| Daily / weekly / monthly briefings | ✅ schedule and delivery | ✅ content (`/v1/summary`, new `/v1/briefing`) | ✅ narrative |
| SLA escalation | ✅ (deduplicated by an escalation key) | ✅ overdue query | — |
| Meter, PMS, POS, accounting ingestion | ✅ connectors and normalisation | ✅ validation and storage via `/v1` | — |
| Copilot Q&A | — | ✅ tools and authorisation | ✅ intent, tool choice, explanation |
| Feedback classification and translation | optional batch | ✅ validation against fixed categories | ✅ |
| Heavy ML (gradient boosting, many series) | — | separate Python service, only if backtests show gains over the in-core models | — |

---

## 6. LLM strategy for Iran

The research (report §Iran context) found:
- OpenAI, Anthropic and Google do not serve Iran.
- Liara runs an OpenAI-compatible AI gateway that resells several model families. This is low-friction, but access could be cut without notice.
- Self-hosting on rented Iranian GPUs is possible. Qwen3 has the cleanest licence (Apache 2.0) among the multilingual models with Persian support.

Design consequences:
- **Default provider kind:** `openai_compatible`. Configuration: `ZH_AI_BASE_URL`, `ZH_AI_MODEL`, `ZH_AI_API_KEY`, all on the server only.
- **Failover:** an optional secondary endpoint (`ZH_AI_FALLBACK_*`). If both fail, the deterministic answer is used.
- **Model portability:** no feature depends on a specific model. Prompts and tool schemas are tested against a fixture set, so a model change can be checked before it is deployed.
- **Persian quality:** classification is good. Translation needs human review: research found English→Persian MT quality weak even for frontier models. So guest-facing text is always approved by staff.
- **Cost estimate** (not measured; based on the research's unverified example gateway price of $0.4 / $1.6 per million input/output tokens for a small model):
  - Per copilot answer, with about 6k tokens in and 0.6k out over up to 4 tool rounds: under $0.01.
  - 50 questions a day: on the order of $5–15 a month.
  - A self-hosted GPU: the research found an RTX 4090 at about 45 million toman a month. That is only worth it for many hotels or for strict data-residency needs.

---

## 7. Data infrastructure and integrations

- **Time:** day keys follow the Tehran calendar; instants are stored as UTC (the convention already used). The Flutter day key will move to Tehran time to remove the device-timezone mismatch.
- **Units and currency:** units are stored on readings (kWh, m³) and money in IRR. Comparisons across months can be shown in real terms using a configurable monthly price index, since inflation is high. The index is a setting, never fetched silently.
- **Provenance:**
  - every record already has `source` (manual / smartMeter / iot / import / seed / pms);
  - forecasts carry model and run;
  - insights carry rule, method and evidence;
  - imported test data stays in `trial` hotels.
- **Quality checks (nightly):**
  - missing days in operations and energy;
  - impossible values (occupied > available, negative stock);
  - meter jumps;
  - stale room statuses.

  Checks produce `system` alerts and lower forecast confidence instead of failing silently.
- **Integrations:** none is assumed to be available.
  - **Existing hooks:** `/v1` endpoints for meters already exist; PMS daily feeds (`dailyOperations` with `source=pms`, `bookingsDaily`) and POS sales will follow the same signed pattern via n8n.
  - **Documentation first:** each connector is documented with its required credentials and licence before it is built.
  - **Not verified:** the research could not confirm public APIs for Iranian PMS vendors or OTAs (Snapptrip, Jabama, Alibaba.ir and others).
  - **Weather:** the free Open-Meteo API is non-commercial. Weather therefore stays optional, switched on with a configured provider.

---

## 8. Security, privacy and governance

- **Server-side authorisation:**
  - every new route uses `caller / requireHotel / requirePerm`;
  - new permissions are added to `rbac.ts`, the Dart mirror and a migration that inserts the catalogue rows;
  - the drift test keeps them aligned.
- **Proposed new permissions:**
  - `ai.recommendations.decide`: approve or reject.
  - `ai.actions.approve`: approve actions, with per-role limits.
  - `ai.scenarios.use`
  - `forecasts.view`
  - `feedback.view|manage`

  Staff roles get none of the decision permissions.
- **Action limits:**
  - a per-hotel settings block defines which action kinds may run without approval (default: notify, and create low-priority tasks);
  - monetary thresholds;
  - a daily cap;
  - a kill switch.

  Executed actions store their inverse (cancel the task, close the ticket) for rollback.
- **Idempotency:** each action has an idempotency key with a unique index, so duplicate deliveries or double taps cannot run twice. This extends today's outbox lease pattern.
- **Prompt injection:** guest and external text goes into a separate quoted field. Tools are read-only. Outputs are validated against fixed category lists. Any guest-facing text needs staff approval. This follows the OWASP LLM01 guidance.
- **Privacy:**
  - **Guest data:** no guest identity data in Phase A–B. In Phase C, feedback stores the minimum fields with a retention date and no inferred sensitive attributes.
  - **Workforce:** analytics are aggregate. Per-person data appears only for the person and their manager, and no scores are used for employment decisions.
  - **Copilot context:** the national IDs and phone numbers of staff are excluded.
- **Regulation:**
  - **Iran:** has no enacted data-protection law yet. A government bill was approved by cabinet in 2024.
  - **EU deployment** (if ever needed): GDPR would apply, and the EU AI Act transparency duty for chatbots. Workforce-management AI is high-risk under Annex III, which is why workforce features stay aggregate and advisory.
- **Audit:** recommendation decisions, action approvals and executions, and copilot tool calls are logged.

---

## 9. Testing and evaluation

| What | How |
|---|---|
| Formula accuracy | Unit tests for every metric, baseline, M&V statistic and scenario line, with hand-computed fixtures. A new PocketBase-side test runner for `core/` |
| Forecast quality | Rolling-origin backtests on the Parsian dataset (365 days). Each model reports MAE, MAPE and MASE against seasonal naive. A model is chosen only if it beats seasonal naive on the backtest; otherwise seasonal naive is published |
| Energy baseline | CV(RMSE) and NMBE checked against ASHRAE Guideline 14 limits before any savings are claimed |
| Recommendations | Scenario tests (like `Test_Scenarios`) that given data produce the expected opportunities and rankings, with no duplicates across modules |
| Copilot grounding | A fixture set of Persian and English questions with expected tool calls and figures. Checks that every number in an answer appears in a tool result. Runs against a stub model in CI, and against the configured endpoint on demand |
| Access control | Integration tests for every new route and collection: other hotel, staff role, missing permission |
| Workflow reliability | Idempotency tests (duplicate approval, overlapping crons). n8n e2e extended for new events, briefing and approval notifications |
| Mobile | Widget tests for new screens. Screenshot runs on phone and tablet sizes, in Persian RTL and English LTR |
| Cost and performance | Timing of each cron on the 475-room dataset. Token usage per copilot answer is logged in `aiConversations.usage` |

**KPIs per feature, reported only from measured data:**

| Feature | KPIs |
|---|---|
| Forecasting | MAPE / MASE |
| Energy | kWh and cost per occupied room; realised savings (only from passing evaluations) |
| Maintenance | mean time to repair, SLA compliance, out-of-order room-days |
| Housekeeping | minutes per checkout clean, readiness on time (once arrivals exist) |
| Inventory | waste share, stock-out days |
| Workforce | staff hours per occupied room |
| Recommendations | acceptance rate, implementation rate, expected vs actual |
| Copilot | answered-with-data rate, fallback rate |

---

## 10. Roadmap

Effort is in focused engineering days, including tests and docs. "Cost" means extra infrastructure or API spend beyond today's Liara apps.

### Phase A: high value, low complexity, current data

The research report ranks twelve features as feasible with current data (its Tier A). This plan builds the shared foundation first (ledger, forecasts, baselines, ranking, copilot). Its other Tier A items (effort-weighted housekeeping, inventory reorder and fraud rules, labour KPIs, staff SOP assistant, pooled benchmark, tariff-capped rate adviser) follow in Phases B and C on top of that foundation.


| # | Feature | Business value | Data / dependencies | Effort | Cost | Risks | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| A1 | **Recommendation Center + closed loop**: extended `aiInsights` ledger, decide with note, create task or ticket from a recommendation, auto-close when the condition clears, evaluation of energy / SLA / stock effects, history | Turns insights into tracked decisions; the basis for every later agent | Existing insights; migration | 5–7 | none | Users ignore it; mitigated by briefing and inbox | Approve, reject or modify is audited; a linked task or ticket is created idempotently; stale insights close; evaluations show baseline, actual, delta and confidence; RBAC tests pass |
| A2 | **Forecasting engine v1**: occupancy, room and total revenue, electricity / water / gas, 28 days ahead with intervals; seasonal naive vs Holt-Winters vs calendar regression, chosen by backtest; `calendarEvents` with fixed solar holidays seeded and lunar holidays entered by the hotel | Planning for staffing, purchasing, energy and revenue | `dailyOperations`, `energyReadings` (≥ 8 weeks; better with 1 year) | 6–8 | none | Shocks (2026 disruptions) break history; mitigated by intervals, a disruption flag and human override | Backtest report on the Parsian data; chosen models beat or equal seasonal naive by MASE; forecasts visible on the dashboard with accuracy; nightly run within its time budget |
| A3 | **Energy intelligence v2**: occupancy-normalised baseline (Guideline 14 statistics), anomaly alerts against that baseline (old static rule kept as fallback), CUSUM drift and savings, cost and carbon per occupied room (grid factor configurable; default Ember 494 g/kWh with source) | Fewer false alarms, credible savings, sustainability reporting | Daily energy + occupancy | 4–5 | none | Seasonality without weather; mitigated by day-of-year terms and weather later | CV(RMSE)/NMBE shown; alert precision on the dataset better than the static rule; CUSUM chart; unit-tested formulas |
| A4 | **GM briefing v2**: daily / weekly / monthly; driver attribution of changes; top opportunities; status of earlier recommendations; deterministic text in fa/en, LLM narration optional; delivered in the app and by n8n | The manager's single "what to do today" view | A1–A3 | 3–4 | LLM optional (≈$0–15 a month) | Information overload; mitigated by a top-5 limit | Numbers match `dailyMetrics`; works with no LLM; n8n workflow 02 extended plus a weekly workflow; e2e test |
| A5 | **Opportunity engine**: unified ranking and dedupe across modules | One ranked list, no double counting | A1 | 2–3 | none | Weak impact estimates; mitigated by showing method and confidence | Duplicate findings merge; ranking reproducible in tests |
| A6 | **Copilot v2**: server-side tool calling (OpenAI-compatible), provenance tags and deep links, deterministic tool-based fallback, grounding test set | Managers ask "why" and get traceable answers | A1–A5 tools; LLM endpoint optional | 5–7 | ≈$5–15 a month at 50 questions a day (estimate) | Gateway availability; model quality in Persian | Every figure in an answer traceable to a tool result in tests; RBAC respected per tool; fallback answers without an LLM |
| A7 | **Hygiene**: Flutter reads `dailyMetrics`; Tehran day key; report bug fixes; docs updated from Firebase to PocketBase; dedupe of SLA escalation | Correctness and trust | — | 2–3 | none | — | Existing tests plus new ones pass; reports match the selected period |

### Phase B: advanced analytics and predictive models

| # | Feature | Data | Effort |
|---|---|---|---|
| B1 | Scenario planner ("digital twin" v1, §4.6) with saved scenarios and comparison | A2 / A3 outputs; optional labour cost settings | 5–7 |
| B2 | Inventory and F&B: consumption forecast per item from occupancy, reorder point with safety stock, waste and shrinkage anomalies, purchase suggestions | Ledger (+ supplier lead times) | 4–5 |
| B3 | Maintenance: asset register, structured ticket cost, preventive-maintenance schedules (including legionella flushing tasks), repair time / failure intervals per asset, risk ranking once enough history exists | New `assets`; importer maps the dataset's equipment IDs | 5–7 |
| B4 | Workforce: staff hours per occupied room, forecast-driven staffing need per department, overtime and absence patterns (aggregate) | Shifts (+ hours) | 4–5 |
| B5 | Finance: budgets, budget vs actual by department, inflation-adjusted trends, contribution of known costs | New `budgets` (manual / CSV) | 4–6 |
| B6 | Operations: cross-department bottleneck analysis (SLA by category and shift, queue age, out-of-order time) | Existing | 3–4 |

### Phase C: integrated agents and controlled automation

| # | Feature | Data | Effort |
|---|---|---|---|
| C1 | `aiActions` executor: approved actions create tickets or tasks, assign people, notify; limits, kill switch, rollback; approval notices via n8n with deep links | A1 | 5–7 |
| C2 | End-to-end playbooks: energy anomaly → investigate (tickets, intensity) → propose maintenance task → approve → track → evaluate; arrivals peak → readiness risk → revised housekeeping plan → approve → publish | C1 + `bookingsDaily` for the second | 5–7 |
| C3 | Guest feedback: staff capture and CSV/review import, LLM classification with validation, service-recovery deadlines, staff translation with review | New `guestFeedback` | 6–8 |
| C4 | Minimal on-the-books input (`bookingsDaily`) and pickup-based forecasting; rate adviser below the approved tariff cap, with approval | Manual entry or PMS | 6–8 |

### Phase D: integrations, optimisation, autonomy

| # | Feature | Notes |
|---|---|---|
| D1 | PMS / channel-manager / POS / accounting connectors | Only after the API, licence and credentials are verified for a specific vendor |
| D2 | Python ML service (gradient boosting, many series) | Only if backtests show material gain over the in-core models |
| D3 | BMS / IoT integration, fault detection and diagnostics, sub-metering | Needs hardware on site |
| D4 | Anonymised benchmarking pool across Zarin hotels | Needs tenant consent and a minimum group size |
| D5 | Monte Carlo scenarios, schedule optimisation (housekeeping routes, shift rosters) | After B1 / B4 |

---

## 11. Proposed first implementation batch

**Batch 1 = A1 + A2 + A3 + A7.** It brings the recommendation ledger, forecasting, energy baselines and the correctness fixes everything else relies on. All four can be built and verified on the Parsian test data.

**Batch 2 = A4 + A5 + A6** builds the briefing, ranking and copilot on top.

Each batch ends with:
- tests (PocketBase, core unit tests, Flutter, n8n e2e where touched);
- a backtest and comparison report on the Parsian dataset;
- updated docs and the Liara update steps.

**Decisions that need the owner:**
1. Which LLM endpoint, if any, should production use? Options: the Liara gateway, a self-hosted model, or none for now. Every feature works without one.
2. The lunar holiday dates (Tasua, Ashura, Ramadan, Eids, etc.) for 1405–1406. These must come from the official calendar. They will not be guessed.
3. Whether a grid emission factor and a monthly price index should be shown by default, or only once the hotel enters its own values.
