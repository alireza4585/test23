// Compares what the server produced for the imported hotel with the
// workbook's Test_Scenarios sheet.
import { addDays } from "./load.mjs";
import { withRetry } from "./apply.mjs";

const n = (s) => Number(String(s).replace(/,/g, ""));
const fmt = (x) => (x === null || x === undefined ? "—" : typeof x === "number" ? x.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(x));
const near = (a, b, tol) => a !== null && a !== undefined && Math.abs(a - b) <= tol;

export async function compare(pb, hotelId, plan, scenarios) {
  const all = (c, filter, fields) => withRetry(() => pb.collection(c).getFullList({ filter: pb.filter(`hotel = {:h}${filter ? ` && ${filter}` : ""}`, { h: hotelId }), fields }));
  const rooms = await all("rooms", "", "status");
  const insights = await all("aiInsights", "status = 'active'", "rule,title,priority,estimatedMonthlySaving");
  const alerts = await all("alerts", "", "type,status,severity,dedupeKey,title,data");
  const metricsDay = addDays(plan.asOfDay, -1);
  const metrics = (await all("dailyMetrics", pb.filter("day = {:d}", { d: metricsDay }), "data"))[0]?.data ?? null;
  const tickets = new Map((await all("maintenanceTickets", "", "id,description,status,priority")).map((t) => [t.id, t]));
  const tasksOfDay = await all("tasks", pb.filter("day = {:d}", { d: metricsDay }), "status");
  const ticketKey = (id) => /^(TKT-\d+)/.exec(tickets.get(id)?.description ?? "")?.[1] ?? id;

  const rows = [];
  const add = (area, item, expected, actual, result, note = "") => rows.push({ area, item, expected, actual, result, note });
  const spikeWindow = `${plan.cutoff} … ${addDays(plan.asOfDay, -1)}`;

  for (const s of scenarios) {
    const area = String(s.area);
    const item = String(s.item);
    const exp = String(s.expected_result_or_data);
    const status = String(s.status);

    if (area.startsWith("Insight engine")) {
      if (status.startsWith("DOES NOT TRIGGER")) {
        const hit = insights.filter((i) => i.rule === item);
        add(area, item, "does not trigger", hit.length ? hit.map((i) => i.title).join("; ") : "not triggered", hit.length ? "✗" : "✓");
        continue;
      }
      const title = exp.split(" | ")[0].trim();
      const priority = /priority=(\w+)/.exec(exp)?.[1];
      const saving = /saving = ([\d,]+)/.exec(exp)?.[1];
      const same = insights.find((i) => i.title === title);
      if (same) {
        const savingOk = !saving || near(same.estimatedMonthlySaving, n(saving), Math.max(1, n(saving) * 0.005));
        const ok = same.priority === priority && savingOk;
        add(area, item, exp, `${same.title} | priority=${same.priority}${saving ? ` | saving ${fmt(same.estimatedMonthlySaving)}` : ""}`, ok ? "✓" : "≈", ok ? "" : "same insight, different priority or saving");
      } else {
        // Same subject (item, area or room), or the rule's only insight when the title names none.
        const subject = /«(.+)»/.exec(title)?.[1] ?? / در (.+) طی/.exec(title)?.[1];
        const near1 = insights.find((i) => i.rule === item && (subject ? i.title.includes(subject) : insights.filter((x) => x.rule === item).length === 1));
        add(area, item, exp, near1 ? `${near1.title} | priority=${near1.priority}` : "not triggered", near1 ? "≈" : "✗", near1 ? "same subject, different figure" : "");
      }
      continue;
    }

    if (area.startsWith("Nightly rollup")) {
      const m = metrics;
      const checks = [
        ["occupancy %", /occupancy ([\d.]+)%/, m?.occupancyRate, 0.05],
        ["ADR", /ADR (\d[\d,]*\d)/, m?.adr, 1],
        ["RevPAR", /RevPAR (\d[\d,]*\d)/, m?.revpar, 1],
        ["electricity kWh", /electricity (\d[\d,]*) kWh/, m?.energy?.electricity, 0.5],
        ["electricity vs baseline %", /\(([\d.]+)% vs baseline\)/, m?.electricityVsBaselinePct, 0.05],
        ["maintenance open", /open (\d+)/, m?.maintenance?.open, 0],
        ["maintenance overdue", /overdue (\d+)/, m?.maintenance?.overdue, 0],
        ["maintenance critical", /critical (\d+)/, m?.maintenance?.critical, 0],
        ["avg checkout clean min", /checkout clean ([\d.]+) min/, m?.housekeeping?.avgCheckoutCleanMinutes, 0.05],
        ["low stock", /low stock (\d+)/, m?.inventory?.lowStock, 0],
        ["rooms out of order", /rooms OOO (\d+)/, m?.rooms?.outOfOrder, 0],
      ];
      for (const [label, re, actual, tol] of checks) {
        const e = re.exec(exp)?.[1];
        if (e === undefined) continue;
        add(area, `${metricsDay} · ${label}`, e, fmt(actual), near(actual, n(e), tol) ? "✓" : "✗");
      }
      continue;
    }

    if (area === "Alerts (energySpike)") {
      const expected = plan.expect.spikes.filter((x) => x.type === item);
      const actual = alerts.filter((a) => a.type === "energySpike" && a.data?.type === item && a.data?.day >= plan.energyCutoff);
      const crit = (list) => list.filter((x) => x.critical || x.severity === "critical").length;
      add(area, `${item} · ${plan.energyCutoff} … ${addDays(plan.asOfDay, -1)}`, `${expected.length} (${crit(expected)} critical) — subset of: ${exp}`,
        `${actual.length} (${crit(actual)} critical)`, expected.length === actual.length && crit(expected) === crit(actual) ? "✓" : "✗",
        "history before the window is imported quietly by design, so only the window can alert");
      continue;
    }

    if (area === "Alerts (criticalTicket)") {
      const actual = alerts.filter((a) => a.type === "criticalTicket");
      add(area, `high/critical tickets · ${spikeWindow}`, `${plan.expect.criticalTickets} — subset of: ${exp}`, `${actual.length} alerts (${actual.filter((a) => a.status === "open").length} still open)`,
        actual.length === plan.expect.criticalTickets ? "✓" : "✗", "alerts of tickets that are already resolved/closed are resolved");
      continue;
    }

    if (area === "Alerts (maintenanceSla)") {
      const expected = [...exp.matchAll(/TKT-\d+/g)].map((m) => m[0]).sort();
      const actual = alerts.filter((a) => a.type === "maintenanceSla" && a.status !== "resolved").map((a) => ticketKey(a.dedupeKey.replace(/^sla_/, ""))).sort();
      add(area, item, expected.join(", "), actual.join(", ") || "none", JSON.stringify(expected) === JSON.stringify(actual) ? "✓" : "✗");
      continue;
    }

    if (area === "Alerts (lowStock)") {
      const expected = (/items: (.+)$/.exec(exp)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean).sort();
      const actual = alerts.filter((a) => a.type === "lowStock" && a.status !== "resolved").map((a) => a.title.replace(/^کمبود موجودی: /, "")).sort();
      const raised = alerts.filter((a) => a.type === "lowStock").length;
      add(area, item, expected.join(", "), `${actual.join(", ")} (open; ${raised} raised in the window, the rest resolved by later deliveries)`,
        JSON.stringify(expected) === JSON.stringify(actual) ? "✓" : "✗");
      continue;
    }

    if (area === "Rooms board") {
      const counts = {};
      for (const r of rooms) counts[r.status] = (counts[r.status] ?? 0) + 1;
      const pairs = [...exp.matchAll(/(\w+): (\d+)/g)];
      const ok = pairs.every(([, k, v]) => counts[k] === Number(v));
      add(area, item, exp, pairs.map(([, k]) => `${k}: ${counts[k] ?? 0}`).join(", "), ok ? "✓" : "✗");
      continue;
    }

    if (area === "Housekeeping workflow") {
      const open = tasksOfDay.filter((t) => t.status === "pending" || t.status === "inProgress").length;
      add(area, item, `tasks of ${metricsDay} include pending / inProgress`, `${tasksOfDay.length} tasks, ${open} pending/inProgress`,
        open ? "✓" : "✗", open ? "" : "tasks.csv has every task as done; the workbook's Housekeeping_Tasks sheet was not part of the CSV pack");
      continue;
    }

    add(area, item, exp, "", "manual", String(s.how_verified_note ?? ""));
  }
  return rows;
}

export function toMarkdown(rows, header) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [header, "", "| area | item | expected | actual | result | note |", "|---|---|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${esc(r.area)} | ${esc(r.item)} | ${esc(r.expected)} | ${esc(r.actual)} | ${r.result} | ${esc(r.note)} |`);
  const count = (x) => rows.filter((r) => r.result === x).length;
  lines.push("", `✓ ${count("✓")} · ≈ ${count("≈")} · ✗ ${count("✗")} · manual ${count("manual")}`);
  return lines.join("\n");
}
