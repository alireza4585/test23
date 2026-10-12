/// <reference path="../../pb_data/types.d.ts" />
/**
 * Recommendation ledger on top of aiInsights:
 *
 * POST /api/zarin/insights/{id}/decide
 *   {decision: "accepted"|"dismissed"|"implemented", note?, ticket?: {title?, category, priority, room?, area?}}
 *   Records who decided what and why; optionally opens a maintenance ticket
 *   linked to the recommendation (once: a repeated request reuses it). An
 *   accepted or implemented recommendation with an expected impact gets an
 *   evaluation that the nightly run completes after its window.
 *
 * closeCleared: rule-based insights whose condition no longer holds are set
 * to "resolved" with a reason instead of staying active forever.
 *
 * evaluateDue: before/after evaluation of decided recommendations (methods
 * in core.js evaluation.ts); inconclusive results are stored as such.
 */
const z = require(`${__hooks}/lib/zarin.js`);
const core = z.core;

const DECISIONS = ["accepted", "dismissed", "implemented"];
const TICKET_CATEGORY = ["hvac", "electrical", "plumbing", "furniture", "appliance", "itNetwork", "structural", "other"];
const TICKET_PRIORITY = ["low", "medium", "high", "critical"];
const DEFAULT_TICKET_CATEGORY = { energy: "hvac", maintenance: "other", revenue: "other", housekeeping: "other", inventory: "other", staffing: "other" };

function canDecide(c) {
  return z.has(c, "ai.insights.view") && (z.has(c, "dashboard.executive") || z.has(c, "dashboard.operations"));
}

function evaluationStart(rec, decidedAt) {
  const impact = z.jsonOf(rec, "expectedImpact");
  if (!impact || !impact.method) return null;
  const window = core.EVALUATION_WINDOW_DAYS[impact.method];
  if (!window) return { status: "notSupported", method: impact.method, limitations: ["No evaluation method for this recommendation."] };
  return {
    status: "pending", method: impact.method, windowDays: window,
    dueAt: z.pbDate(new Date(decidedAt.getTime() + (window + 1) * 864e5)), limitations: [],
  };
}

function createTicket(app, c, rec, spec) {
  const hotelId = rec.getString("hotel");
  z.requirePerm(c, "maintenance.report");
  const category = TICKET_CATEGORY.indexOf(spec.category) >= 0 ? spec.category : DEFAULT_TICKET_CATEGORY[rec.getString("category")] || "other";
  const priority = TICKET_PRIORITY.indexOf(spec.priority) >= 0 ? spec.priority : rec.getString("priority") === "high" ? "high" : "medium";
  const room = z.sameHotel(app, "rooms", spec.room || "", hotelId);
  const hours = z.hotelSettings(app, hotelId).maintenanceSlaHours[priority] || 24;
  const t = new Record(z.col(app, "maintenanceTickets"), {
    hotel: hotelId,
    title: String(spec.title || rec.getString("title")).slice(0, 200),
    description: `${rec.getString("recommendation")}\n\n— از پیشنهاد هوشمند: ${rec.getString("title")}`.slice(0, 5000),
    category, priority, status: "open",
    room: room ? room.id : "", roomNumber: room ? room.getString("number") : "",
    area: String(spec.area || "").slice(0, 120),
    reportedBy: c.id, reportedByName: c.name, reportedByRole: c.role,
    slaDueAt: z.pbDate(new Date(Date.now() + hours * 3600 * 1000)),
    updatedBy: c.id,
  });
  app.save(t);
  app.save(new Record(z.col(app, "ticketEvents"), {
    hotel: hotelId, ticket: t.id, type: "comment", actor: c.id, actorName: c.name,
    note: `ایجاد از پیشنهاد هوشمند (${rec.getString("key")})`,
  }));
  return t;
}

function decide(e) {
  const c = z.caller(e);
  const b = e.requestInfo().body || {};
  const decision = b.decision;
  if (DECISIONS.indexOf(decision) < 0) throw z.bad("invalid_decision");
  const note = String(b.note || "").trim().slice(0, 1000);
  let out = null;
  e.app.runInTransaction((tx) => {
    const rec = z.find(tx, "aiInsights", e.request.pathValue("id"));
    const hotelId = z.requireHotel(c, rec.getString("hotel"));
    if (!canDecide(c)) throw z.forbidden("missing_permission", { permission: "dashboard.operations" });
    if (rec.getString("status") === "resolved") throw z.bad("insight_resolved");
    const before = rec.getString("status");
    const now = new Date();
    if (b.ticket && decision !== "dismissed" && !rec.getString("linkedTicket")) {
      rec.set("linkedTicket", createTicket(tx, c, rec, b.ticket).id);
    }
    rec.set("status", decision);
    rec.set("decisionNote", note);
    rec.set("decidedBy", c.id);
    rec.set("decidedByName", c.name);
    rec.set("decidedAt", z.pbDate(now));
    rec.set("updatedBy", c.id);
    if (decision === "dismissed") rec.set("evaluation", null);
    else if (before === "active" || before === "dismissed" || !z.jsonOf(rec, "evaluation")) rec.set("evaluation", evaluationStart(rec, now));
    tx.save(rec);
    z.audit(tx, hotelId, {
      action: "insights.decide", collection: "aiInsights", id: rec.id, actor: z.actorOf(c),
      changes: { status: [before, decision], note, linkedTicket: rec.getString("linkedTicket") || null },
    });
    out = rec;
  });
  if (out.getString("linkedTicket")) {
    z.emit(e.app, "insight.decided", out.getString("hotel"), { insightId: out.id, decision, ticketId: out.getString("linkedTicket") });
  }
  return e.json(200, out);
}

/** Active rule insights not produced by the latest run are resolved. */
function closeCleared(app, hotelId, drafts, now) {
  const live = {};
  for (const d of drafts) live[d.id] = true;
  let closed = 0;
  for (const rec of z.findMany(app, "aiInsights", "hotel = {:h} && status = 'active' && source = 'rules'", { h: hotelId })) {
    if (live[rec.getString("key")]) continue;
    rec.set("status", "resolved");
    rec.set("closedReason", "not_detected_in_latest_run");
    rec.set("decidedAt", z.pbDate(now));
    app.save(rec);
    closed++;
  }
  return closed;
}

// ------------------------------------------------------------ evaluation
function durations(app, hotelId, taskType, from, to) {
  const out = [];
  for (const t of z.findMany(app, "tasks", "hotel = {:h} && type = {:ty} && status = 'done' && day >= {:f} && day <= {:t}", { h: hotelId, ty: taskType, f: from, t: to })) {
    const s = z.parseDate(t.getString("startedAt"));
    const d = z.parseDate(t.getString("completedAt"));
    if (s && d && d > s) out.push((d.getTime() - s.getTime()) / 60000);
  }
  return out;
}

function ticketsAt(app, hotelId, category, where, from, to) {
  let n = 0;
  for (const t of z.findMany(app, "maintenanceTickets", "hotel = {:h} && category = {:c} && created >= {:f} && created < {:t}", { h: hotelId, c: category, f: z.pbDate(from), t: z.pbDate(to) })) {
    const at = t.getString("roomNumber") ? `room-${t.getString("roomNumber")}` : t.getString("area").trim();
    if (at === where) n++;
  }
  return n;
}

function evaluateOne(app, rec, now) {
  const hotelId = rec.getString("hotel");
  const impact = z.jsonOf(rec, "expectedImpact") || {};
  const subject = impact.subject || {};
  const decidedAt = z.parseDate(rec.getString("decidedAt"));
  const D = z.dayKey(decidedAt);
  const days = core.EVALUATION_WINDOW_DAYS[impact.method];
  const win = { beforeFrom: z.addDays(D, -days), beforeTo: z.addDays(D, -1), afterFrom: z.addDays(D, 1), afterTo: z.addDays(D, days) };
  switch (impact.method) {
    case "energyBaseline": {
      const forecasting = require(`${__hooks}/lib/forecasting.js`);
      const type = subject.type || "electricity";
      const model = forecasting.energyModel(app, hotelId, type, D);
      const after = forecasting.energyRows(app, hotelId, type, win.afterFrom, win.afterTo);
      const tariff = z.hotelSettings(app, hotelId).energyTariff[type] || 0;
      return core.evaluateEnergy(model, after, tariff, { beforeFrom: model ? model.from : undefined, beforeTo: model ? model.to : undefined, afterFrom: win.afterFrom, afterTo: win.afterTo });
    }
    case "durationAvg":
      return core.evaluateMean("durationAvg", "min", durations(app, hotelId, subject.taskType || "checkoutClean", win.beforeFrom, win.beforeTo),
        durations(app, hotelId, subject.taskType || "checkoutClean", win.afterFrom, win.afterTo), win, true);
    case "ticketCount": {
      const before = ticketsAt(app, hotelId, subject.category, subject.where, new Date(decidedAt.getTime() - days * 864e5), decidedAt);
      const after = ticketsAt(app, hotelId, subject.category, subject.where, decidedAt, new Date(decidedAt.getTime() + days * 864e5));
      return core.evaluateCount("ticketCount", "tickets", before, after, win);
    }
    case "stockout": {
      let hit = null;
      for (const m of z.findMany(app, "inventoryMovements", "hotel = {:h} && item = {:i} && created >= {:f} && created <= {:t}", { h: hotelId, i: subject.itemId || "", f: z.pbDate(decidedAt), t: z.pbDate(new Date(decidedAt.getTime() + days * 864e5)) }, "created")) {
        if (m.getFloat("quantityAfter") <= 0) { hit = m; break; }
      }
      return core.evaluateOutcome("stockout", !!hit, hit ? `stock reached zero on ${z.dayKey(z.parseDate(hit.getString("created")))}` : `no stock-out within ${days} days`, win);
    }
    case "oooRooms": {
      const listed = subject.rooms || [];
      const still = [];
      for (const number of listed) {
        const r = z.findFirst(app, "rooms", "hotel = {:h} && number = {:n}", { h: hotelId, n: number });
        if (r && r.getString("status") === "outOfOrder" && z.parseDate(r.getString("updated")) <= decidedAt) still.push(number);
      }
      return core.evaluateOutcome("oooRooms", still.length > 0, still.length ? `still out of order since before the decision: ${still.join(", ")}` : `all ${listed.length} rooms returned to service`, win);
    }
    default:
      return { status: "notSupported", method: impact.method || "", limitations: ["No automatic evaluation for this recommendation; compare in the forecast and report views."], window: win };
  }
}

/** Completes evaluations whose window has passed (as of [now]). */
function evaluateDue(app, hotelId, now) {
  let done = 0;
  for (const rec of z.findMany(app, "aiInsights", "hotel = {:h} && (status = 'accepted' || status = 'implemented')", { h: hotelId })) {
    const ev = z.jsonOf(rec, "evaluation");
    if (!ev || ev.status !== "pending") continue;
    const due = z.parseDate(ev.dueAt);
    if (!due || due > now || !rec.getString("decidedAt")) continue;
    const result = Object.assign(evaluateOne(app, rec, now), { evaluatedAt: z.pbDate(now) });
    rec.set("evaluation", result);
    app.save(rec);
    z.emit(app, "insight.evaluated", hotelId, { insightId: rec.id, status: result.status, improved: result.improved === undefined ? null : result.improved });
    done++;
  }
  return done;
}

module.exports = { decide, closeCleared, evaluateDue, canDecide };
