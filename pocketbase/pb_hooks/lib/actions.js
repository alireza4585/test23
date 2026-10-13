/// <reference path="../../pb_data/types.d.ts" />
/**
 * Action Center (AI phase 1, F1; flag recommendationLoop). Extends the Batch 1
 * recommendation loop: every insight gets typed actions (core.js actions.ts),
 * a manager approves or rejects them, and the server executes them through the
 * same transactional code paths as the app. Nothing runs without an approval.
 *
 *   POST /api/zarin/actions/{id}/decide  {decision: "approve"|"reject", note?, params?}
 *   POST /api/zarin/actions              {hotelId, type: "adjustBaseline", reason, params: {meterType, days}}
 *
 * Who may decide (enforced here, the app only mirrors it):
 *   - ai.actions.approve, and the action's department in ROLE_ACTION_DEPARTMENTS
 *     (department managers: their own department only; GM and operations: all);
 *   - createTicket also needs maintenance.report, createTask housekeeping.assign;
 *   - adjustBaseline only generalManager / energyManager, with a reason, at most
 *     MAX_EXCLUDED_DAYS_PER_MONTH days per meter and Jalali month; excluded days
 *     leave the model fit only, they are still scored and still alarm;
 *   - revenue-derived actions are invisible (404) without finance.view.
 * Every decision, execution and outcome change is in auditLogs; a re-measured
 * outcome keeps the previous value there.
 *
 * Outcomes: executed actions with an expected impact are measured after their
 * window with the Batch 1 / F2 evaluation (labelled observational, not
 * causal); without enough data the outcome is "notMeasurable", never a guess.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const TICKET_CATEGORY = ["hvac", "electrical", "plumbing", "furniture", "appliance", "itNetwork", "structural", "other"];
const TICKET_PRIORITY = ["low", "medium", "high", "critical"];
const TASK_PRIORITY = ["low", "normal", "high", "urgent"];
const METER_TYPES = ["electricity", "water", "gas"];
const OUTCOME_LABEL = "observational";
const STATUS_MAP = { evaluated: "measured", inconclusive: "inconclusive", insufficientData: "notMeasurable", notSupported: "notMeasurable" };

function financeView(c) {
  return z.has(c, "finance.view");
}

/** Roles (other than superAdmin) that may decide actions of [department]. */
function approverRoles(department, category) {
  return core.ROLES.filter((r) => r !== "superAdmin"
    && core.canDecideDepartment(r, department)
    && core.can(r, "ai.actions.approve")
    && (category !== "revenue" || core.can(r, "finance.view")));
}

// ------------------------------------------------------------ proposals
/** Proposes the typed actions of an insight once per insight cycle. Returns the number created. */
function proposeFor(app, insight, now) {
  const hotelId = insight.getString("hotel");
  const since = insight.getString("activatedAt") || "";
  const existing = since
    ? z.findMany(app, "aiActions", "hotel = {:h} && insight = {:i} && created >= {:s}", { h: hotelId, i: insight.id, s: since }, "", 1)
    : z.findMany(app, "aiActions", "hotel = {:h} && insight = {:i}", { h: hotelId, i: insight.id }, "", 1);
  if (existing.length) return 0;
  const drafts = core.proposeActions({
    rule: insight.getString("rule"), category: insight.getString("category"), title: insight.getString("title"),
    recommendation: insight.getString("recommendation"), priority: insight.getString("priority") || "medium",
    expectedImpact: z.jsonOf(insight, "expectedImpact"),
  });
  let n = 0;
  for (const d of drafts) {
    const key = `${insight.id}:${d.type}:${z.dayKey(now)}`;
    if (z.findFirst(app, "aiActions", "hotel = {:h} && idempotencyKey = {:k}", { h: hotelId, k: key })) continue;
    const rec = new Record(z.col(app, "aiActions"), {
      hotel: hotelId, insight: insight.id, category: insight.getString("category"), department: d.department, type: d.type,
      status: "proposed", priority: d.priority, title: d.title, reason: insight.getString("recommendation").slice(0, 1000),
      params: d.params, expectedImpact: d.expectedImpact || null, idempotencyKey: key, source: "rules",
    });
    app.save(rec);
    n++;
    announce(app, rec, "action.proposed");
  }
  return n;
}

/** In-app notice to the approvers of a high-priority action, and an n8n event. */
function announce(app, rec, event) {
  if (rec.getString("priority") !== "high") return;
  const hotelId = rec.getString("hotel");
  const roles = approverRoles(rec.getString("department"), rec.getString("category"));
  z.notify(app, {
    hotelId, roles, title: event === "action.reminder" ? `یادآوری: ${rec.getString("title")}` : rec.getString("title"),
    body: "یک اقدام پیشنهادی منتظر تأیید یا رد شماست.", category: "ai", severity: "warning", route: "/insights",
  });
  z.emit(app, event, hotelId, { actionId: rec.id, type: rec.getString("type"), department: rec.getString("department"), priority: "high", roles });
}

/** Pending actions of insights that are no longer active expire. */
function expireFor(app, insightId) {
  for (const a of z.findMany(app, "aiActions", "insight = {:i} && status = 'proposed'", { i: insightId })) {
    a.set("status", "expired");
    app.save(a);
  }
}

/** 24-hour reminder for pending high-priority actions (once per action). */
function remind(app, hotelId, now) {
  const before = z.pbDate(new Date(now.getTime() - 24 * 3600 * 1000));
  let n = 0;
  for (const a of z.findMany(app, "aiActions", "hotel = {:h} && status = 'proposed' && priority = 'high' && remindedAt = '' && created <= {:b}", { h: hotelId, b: before })) {
    a.set("remindedAt", z.pbDate(now));
    app.save(a);
    announce(app, a, "action.reminder");
    n++;
  }
  return n;
}

/** Nightly step (after the insights run): propose, expire, remind, measure. */
function nightly(app, hotelId, now) {
  let proposed = 0;
  for (const ins of z.findMany(app, "aiInsights", "hotel = {:h} && status = 'active'", { h: hotelId })) proposed += proposeFor(app, ins, now);
  for (const ins of z.findMany(app, "aiInsights", "hotel = {:h} && status = 'resolved'", { h: hotelId })) expireFor(app, ins.id);
  return { proposed, reminded: remind(app, hotelId, now), measured: measureDue(app, hotelId, now) };
}

// ----------------------------------------------------- adjustBaseline guards
/** Throws unless [days] fit the per-month cap (counting rows already excluded). */
function checkExclusionCap(app, hotelId, meterType, days) {
  const perMonth = {};
  for (const d of days) {
    const k = core.exclusionMonth(d);
    perMonth[k] = (perMonth[k] || 0) + 1;
  }
  for (const k of Object.keys(perMonth)) {
    const inMonth = days.filter((d) => core.exclusionMonth(d) === k);
    // Existing exclusions of the same Jalali month (a month spans ≤ 31 days around these days).
    const from = z.addDays(inMonth[0], -31);
    const to = z.addDays(inMonth[inMonth.length - 1], 31);
    const existing = z.findMany(app, "energyExclusions", "hotel = {:h} && type = {:t} && day >= {:f} && day <= {:to}", { h: hotelId, t: meterType, f: from, to })
      .filter((r) => core.exclusionMonth(r.getString("day")) === k && inMonth.indexOf(r.getString("day")) < 0).length;
    if (existing + perMonth[k] > core.MAX_EXCLUDED_DAYS_PER_MONTH) {
      throw z.bad("exclusion_cap_exceeded", { month: k, allowed: core.MAX_EXCLUDED_DAYS_PER_MONTH, existing, requested: perMonth[k] });
    }
  }
}

function validDays(app, hotelId, meterType, raw, now) {
  if (METER_TYPES.indexOf(meterType) < 0) throw z.bad("invalid_meter_type");
  const today = z.dayKey(now);
  const days = z.unique((Array.isArray(raw) ? raw : []).map(String)).sort();
  if (!days.length || days.length > 31) throw z.bad("invalid_days", { max: 31 });
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= today || d < z.addDays(today, -365)) throw z.bad("invalid_day", { day: d });
    if (!z.findFirst(app, "energyReadings", "hotel = {:h} && type = {:t} && day = {:d}", { h: hotelId, t: meterType, d })) throw z.bad("no_reading_for_day", { day: d });
  }
  return days;
}

function requireBaselineRole(c) {
  if (core.BASELINE_ADJUST_ROLES.indexOf(c.role) < 0) throw z.forbidden("baseline_adjust_not_allowed", { role: c.role });
}

/** POST /api/zarin/actions — manual proposal; phase 1 accepts adjustBaseline only. */
function create(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const hotelId = z.requireHotel(c, b.hotelId);
  z.requireFeature(e.app, hotelId, "recommendationLoop");
  z.requireFeature(e.app, hotelId, "energyBaseline");
  if (b.type !== "adjustBaseline") throw z.bad("type_not_manual");
  z.requirePerm(c, "ai.actions.approve");
  requireBaselineRole(c);
  const reason = String(b.reason || "").trim();
  if (reason.length < 10 || reason.length > 1000) throw z.bad("reason_required", { min: 10 });
  const p = b.params || {};
  const now = new Date();
  const days = validDays(e.app, hotelId, p.meterType, p.days, now);
  checkExclusionCap(e.app, hotelId, p.meterType, days);
  const label = { electricity: "برق", water: "آب", gas: "گاز" }[p.meterType];
  let rec = null;
  e.app.runInTransaction((tx) => {
    rec = new Record(z.col(tx, "aiActions"), {
      hotel: hotelId, category: "energy", department: "energy", type: "adjustBaseline", status: "proposed", priority: "medium",
      title: `کنار گذاشتن ${days.length} روز از مدل ${label}`, reason, params: { meterType: p.meterType, days },
      idempotencyKey: `manual:${c.id}:${now.getTime()}`, source: "manual",
    });
    tx.save(rec);
    z.audit(tx, hotelId, { action: "actions.create", collection: "aiActions", id: rec.id, actor: z.actorOf(c), changes: { type: "adjustBaseline", meterType: p.meterType, days, reason } });
  });
  return e.json(200, rec);
}

// --------------------------------------------------------------- execute
function executeTicket(tx, c, rec, p) {
  z.requirePerm(c, "maintenance.report");
  const hotelId = rec.getString("hotel");
  const category = TICKET_CATEGORY.indexOf(p.category) >= 0 ? p.category : "other";
  const priority = TICKET_PRIORITY.indexOf(p.priority) >= 0 ? p.priority : "medium";
  const room = p.roomNumber ? z.findFirst(tx, "rooms", "hotel = {:h} && number = {:n}", { h: hotelId, n: String(p.roomNumber) }) : null;
  const hours = z.hotelSettings(tx, hotelId).maintenanceSlaHours[priority] || 24;
  const t = new Record(z.col(tx, "maintenanceTickets"), {
    hotel: hotelId, title: String(p.title || rec.getString("title")).slice(0, 200),
    description: `${String(p.description || rec.getString("reason"))}\n\n— از مرکز اقدام: ${rec.getString("title")}`.slice(0, 5000),
    category, priority, status: "open", room: room ? room.id : "", roomNumber: room ? room.getString("number") : "",
    area: String(p.area || "").slice(0, 120), reportedBy: c.id, reportedByName: c.name, reportedByRole: c.role,
    slaDueAt: z.pbDate(new Date(Date.now() + hours * 3600 * 1000)), updatedBy: c.id,
  });
  tx.save(t);
  tx.save(new Record(z.col(tx, "ticketEvents"), {
    hotel: hotelId, ticket: t.id, type: "comment", actor: c.id, actorName: c.name, note: `ایجاد از مرکز اقدام (${rec.id})`,
  }));
  const insightId = rec.getString("insight");
  if (insightId) {
    const ins = z.findFirst(tx, "aiInsights", "id = {:id}", { id: insightId });
    if (ins && !ins.getString("linkedTicket")) {
      ins.set("linkedTicket", t.id);
      tx.save(ins);
    }
  }
  return { collection: "maintenanceTickets", ids: [t.id] };
}

function executeTasks(tx, c, rec, p) {
  z.requirePerm(c, "housekeeping.assign");
  const hotelId = rec.getString("hotel");
  const rooms = (Array.isArray(p.rooms) ? p.rooms : []).map(String).slice(0, 20);
  if (!rooms.length) throw z.bad("no_rooms");
  const ids = [];
  const today = z.dayKey(new Date());
  for (const number of rooms) {
    const room = z.findFirst(tx, "rooms", "hotel = {:h} && number = {:n}", { h: hotelId, n: number });
    if (!room) throw z.bad("room_not_found", { room: number });
    const t = new Record(z.col(tx, "tasks"), {
      hotel: hotelId, kind: "housekeeping", day: today, room: room.id, roomNumber: number, type: p.taskType === "deepClean" ? "deepClean" : "inspection",
      status: "pending", priority: TASK_PRIORITY.indexOf(p.priority) >= 0 ? p.priority : "normal",
      notes: String(p.notes || "").slice(0, 1000), createdBy: c.id, createdByName: c.name, updatedBy: c.id,
    });
    tx.save(t);
    ids.push(t.id);
  }
  return { collection: "tasks", ids };
}

function executeNotify(tx, c, rec, p) {
  const roles = (Array.isArray(p.roles) ? p.roles : []).filter((r) => core.isRole(r) && r !== "superAdmin");
  if (!roles.length) throw z.bad("no_roles");
  // A revenue-derived notice goes only to roles that may read revenue.
  const allowed = rec.getString("category") === "revenue" ? roles.filter((r) => core.can(r, "finance.view")) : roles;
  if (!allowed.length) throw z.bad("no_roles");
  z.notify(tx, {
    hotelId: rec.getString("hotel"), roles: allowed, title: String(p.title || rec.getString("title")).slice(0, 120),
    body: String(p.body || "").slice(0, 500), category: "ai", severity: rec.getString("priority") === "high" ? "warning" : "info",
    route: "/insights", createdBy: c.id,
  });
  return { collection: "notifications", roles: allowed };
}

function executeAdjust(tx, c, rec, p) {
  requireBaselineRole(c);
  const hotelId = rec.getString("hotel");
  const reason = rec.getString("reason").trim();
  if (reason.length < 10) throw z.bad("reason_required", { min: 10 });
  const days = validDays(tx, hotelId, p.meterType, p.days, new Date());
  checkExclusionCap(tx, hotelId, p.meterType, days);
  const ids = [];
  for (const d of days) {
    if (z.findFirst(tx, "energyExclusions", "hotel = {:h} && type = {:t} && day = {:d}", { h: hotelId, t: p.meterType, d })) continue;
    const x = new Record(z.col(tx, "energyExclusions"), {
      hotel: hotelId, type: p.meterType, day: d, reason, action: rec.id, createdBy: c.id, createdByName: c.name,
    });
    tx.save(x);
    ids.push(x.id);
  }
  return { collection: "energyExclusions", ids };
}

const EXECUTE = { createTicket: executeTicket, createTask: executeTasks, notifyRole: executeNotify, adjustBaseline: executeAdjust };

/** Outcome to start with: pending until the evaluation window, or not measurable. */
function startOutcome(app, rec, now) {
  const impact = z.jsonOf(rec, "expectedImpact");
  if (!impact || !impact.method) return { status: "notMeasurable", reason: "no_expected_impact", measuredAt: z.pbDate(now), label: OUTCOME_LABEL };
  const days = core.EVALUATION_WINDOW_DAYS[impact.method];
  if (!days) return { status: "notMeasurable", reason: `no_method:${impact.method}`, method: impact.method, measuredAt: z.pbDate(now), label: OUTCOME_LABEL };
  return { status: "pending", method: impact.method, windowDays: days, dueAt: z.pbDate(new Date(now.getTime() + (days + 1) * 864e5)), label: OUTCOME_LABEL };
}

/** POST /api/zarin/actions/{id}/decide */
function decide(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const decision = b.decision;
  if (decision !== "approve" && decision !== "reject") throw z.bad("invalid_decision");
  const note = String(b.note || "").trim().slice(0, 1000);
  const rec = z.find(e.app, "aiActions", e.request.pathValue("id"));
  const hotelId = z.requireHotel(c, rec.getString("hotel"));
  if (rec.getString("category") === "revenue" && !financeView(c)) throw z.notFound();
  z.requireFeature(e.app, hotelId, "recommendationLoop");
  z.requirePerm(c, "ai.actions.approve");
  const department = rec.getString("department");
  if (!core.canDecideDepartment(c.role, department)) throw z.forbidden("department_not_allowed", { department });
  if (rec.getString("status") !== "proposed") throw z.bad("action_not_pending", { status: rec.getString("status") });
  const type = rec.getString("type");
  const now = new Date();

  if (decision === "reject") {
    if (note.length < 3) throw z.bad("note_required");
    e.app.runInTransaction((tx) => {
      const r = z.find(tx, "aiActions", rec.id);
      if (r.getString("status") !== "proposed") throw z.bad("action_not_pending");
      r.load({ status: "rejected", decidedBy: c.id, decidedByName: c.name, decidedByRole: c.role, decidedAt: z.pbDate(now), decisionNote: note });
      tx.save(r);
      z.audit(tx, hotelId, { action: "actions.decide", collection: "aiActions", id: r.id, actor: z.actorOf(c), changes: { decision, type, department, note } });
    });
    return e.json(200, z.find(e.app, "aiActions", rec.id));
  }

  // Approve: type-specific permission first (a refusal leaves the action pending).
  if (type === "createTicket") z.requirePerm(c, "maintenance.report");
  if (type === "createTask") z.requirePerm(c, "housekeeping.assign");
  if (type === "adjustBaseline") requireBaselineRole(c);
  const params = Object.assign({}, z.jsonOf(rec, "params") || {});
  const edits = {};
  const editable = core.EDITABLE_PARAMS[type] || [];
  for (const k of Object.keys(b.params || {})) {
    if (editable.indexOf(k) < 0) throw z.bad("param_not_editable", { param: k });
    edits[k] = { from: params[k] === undefined ? null : params[k], to: b.params[k] };
    params[k] = b.params[k];
  }
  try {
    e.app.runInTransaction((tx) => {
      const r = z.find(tx, "aiActions", rec.id);
      if (r.getString("status") !== "proposed") throw z.bad("action_not_pending");
      const ref = EXECUTE[type](tx, c, r, params);
      const impact = z.jsonOf(r, "expectedImpact");
      // Energy impact is measured against the stored F2 model active at the decision.
      if (impact && impact.method === "energyBaseline") {
        const energy = require(`${__hooks}/lib/energy.js`);
        const m = energy.modelRecord(tx, hotelId, (impact.subject || {}).type || "electricity");
        if (m && m.getString("status") === "active" && m.getBool("valid")) r.set("expectedImpact", Object.assign({}, impact, { modelId: m.id }));
      }
      r.load({
        status: "executed", params, decidedBy: c.id, decidedByName: c.name, decidedByRole: c.role, decidedAt: z.pbDate(now),
        decisionNote: note, executedAt: z.pbDate(now), executedRef: ref, error: "",
      });
      r.set("outcome", startOutcome(tx, r, now));
      tx.save(r);
      z.audit(tx, hotelId, { action: "actions.decide", collection: "aiActions", id: r.id, actor: z.actorOf(c), changes: { decision, type, department, note, edits } });
      z.audit(tx, hotelId, { action: "actions.execute", collection: "aiActions", id: r.id, actor: z.actorOf(c), changes: { type, executedRef: ref } });
    });
  } catch (err) {
    // Execution failed (validation, missing room, cap): recorded, then reported.
    const code = (err && err.data && err.data.code && err.data.code.code) || String(err && err.message || err).slice(0, 200);
    if (code === "action_not_pending" || (err && err.status === 403)) throw err;
    const r = z.find(e.app, "aiActions", rec.id);
    r.load({ status: "failed", decidedBy: c.id, decidedByName: c.name, decidedByRole: c.role, decidedAt: z.pbDate(now), decisionNote: note, error: code });
    e.app.save(r);
    z.audit(e.app, hotelId, { action: "actions.failed", collection: "aiActions", id: r.id, actor: z.actorOf(c), changes: { type, error: code } });
    throw err;
  }
  const out = z.find(e.app, "aiActions", rec.id);
  z.emit(e.app, "action.executed", hotelId, { actionId: out.id, type, department, executedRef: z.jsonOf(out, "executedRef") });
  return e.json(200, out);
}

/**
 * Records an executed action for a ticket opened through the classic insight
 * decision (so every execution is in the Action Center ledger).
 */
function recordInsightTicket(app, c, insight, ticketId, now) {
  const hotelId = insight.getString("hotel");
  const rec = new Record(z.col(app, "aiActions"), {
    hotel: hotelId, insight: insight.id, category: insight.getString("category"), department: insight.getString("category") === "energy" ? "energy" : "maintenance",
    type: "createTicket", status: "executed", priority: insight.getString("priority") || "medium",
    title: `تیکت از تصمیم پیشنهاد: ${insight.getString("title")}`.slice(0, 200), reason: insight.getString("recommendation").slice(0, 1000),
    params: { ticketId }, expectedImpact: z.jsonOf(insight, "expectedImpact"), idempotencyKey: `insightDecide:${insight.id}:${ticketId}`,
    decidedBy: c.id, decidedByName: c.name, decidedByRole: c.role, decidedAt: z.pbDate(now), executedAt: z.pbDate(now),
    executedRef: { collection: "maintenanceTickets", ids: [ticketId] }, source: "insightDecide",
  });
  rec.set("outcome", startOutcome(app, rec, now));
  app.save(rec);
  return rec;
}

// --------------------------------------------------------------- outcomes
/**
 * Measures executed actions whose window has passed. An inconclusive or
 * not-measurable result is re-measured while the action is younger than three
 * windows; every overwrite keeps the previous outcome in auditLogs.
 */
function measureDue(app, hotelId, now) {
  const recommendations = require(`${__hooks}/lib/recommendations.js`);
  let n = 0;
  for (const a of z.findMany(app, "aiActions", "hotel = {:h} && status = 'executed'", { h: hotelId })) {
    const prev = z.jsonOf(a, "outcome") || {};
    const impact = z.jsonOf(a, "expectedImpact");
    if (!impact || !impact.method || !core.EVALUATION_WINDOW_DAYS[impact.method]) continue;
    const window = core.EVALUATION_WINDOW_DAYS[impact.method];
    const decided = z.parseDate(a.getString("executedAt") || a.getString("decidedAt"));
    if (!decided) continue;
    const due = decided.getTime() + (window + 1) * 864e5;
    if (now.getTime() < due) continue;
    if (prev.status === "measured") continue;
    if (prev.status && prev.status !== "pending") {
      const last = z.parseDate(prev.measuredAt);
      const retry = last && now.getTime() - last.getTime() >= window * 864e5 && now.getTime() - decided.getTime() < 3 * window * 864e5;
      if (!retry) continue;
    }
    const ev = recommendations.evaluateImpact(app, hotelId, impact, decided);
    const next = {
      status: STATUS_MAP[ev.status] || "notMeasurable", method: ev.method || impact.method, window: ev.window || null,
      measuredAt: z.pbDate(now), value: ev.delta === undefined ? null : ev.delta, unit: ev.unit || impact.unit || "",
      ci95: ev.ci95 || null, expected: ev.baseline === undefined ? null : ev.baseline, actual: ev.actual === undefined ? null : ev.actual,
      improved: ev.improved === undefined ? null : ev.improved, detail: ev.detail || "", limitations: ev.limitations || [], label: OUTCOME_LABEL,
    };
    a.set("outcome", next);
    app.save(a);
    z.audit(app, hotelId, { action: "actions.outcome", collection: "aiActions", id: a.id, actor: null, source: "server", changes: { previous: prev, next } });
    z.emit(app, "action.measured", hotelId, { actionId: a.id, status: next.status, improved: next.improved });
    n++;
  }
  return n;
}

module.exports = { approverRoles, proposeFor, expireFor, remind, nightly, create, decide, recordInsightTicket, measureDue, checkExclusionCap };
