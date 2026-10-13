/**
 * Action Center (AI phase 1, F1): turns an insight into typed, approvable
 * actions. Deterministic and LLM-free; the server stores the drafts as
 * `proposed`, a role with `ai.actions.approve` for the action's department
 * decides, and the server executes through its existing transactional code.
 *
 * Types in phase 1 (anything else is refused by the server):
 *   createTicket   a maintenance ticket            needs maintenance.report
 *   createTask     housekeeping task(s) per room   needs housekeeping.assign
 *   notifyRole     an in-app notification           ai.actions.approve only
 *   adjustBaseline keep days out of an energy fit   generalManager / energyManager,
 *                  reason required, at most MAX_EXCLUDED_DAYS_PER_MONTH per
 *                  meter and Jalali month; never proposed automatically.
 * Financial actions are out of scope (drafts only, phase 2); nothing that
 * affects guests is executed automatically.
 */
import type { ActionDepartment } from "../domain/rbac";
import type { ExpectedImpact, InsightCategory } from "./rules-engine";

export const ACTION_TYPES = ["createTicket", "createTask", "notifyRole", "adjustBaseline"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface ActionDraft {
  type: ActionType;
  department: ActionDepartment;
  title: string;
  priority: "low" | "medium" | "high";
  params: Record<string, unknown>;
  expectedImpact?: ExpectedImpact;
}

/** The parts of an insight the mapping reads (an aiInsights record or an InsightDraft). */
export interface InsightLike {
  rule: string;
  category: InsightCategory | string;
  title: string;
  recommendation: string;
  priority: "low" | "medium" | "high";
  expectedImpact?: ExpectedImpact | null;
}

const TICKET_CATEGORIES = ["hvac", "electrical", "plumbing", "furniture", "appliance", "itNetwork", "structural", "other"];

/** Fields the decider may change before approving, per type. */
export const EDITABLE_PARAMS: Record<ActionType, string[]> = {
  createTicket: ["title", "priority", "category"],
  createTask: ["priority", "notes"],
  notifyRole: ["body"],
  adjustBaseline: [],
};

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Typed actions for an insight; [] when the rule has no action in phase 1. */
export function proposeActions(insight: InsightLike): ActionDraft[] {
  const impact = insight.expectedImpact ?? undefined;
  const subject = (impact?.subject ?? {}) as Record<string, unknown>;
  const high = insight.priority === "high";
  switch (insight.rule) {
    case "energyModel":
    case "energyIntensity":
      return [{
        type: "createTicket",
        department: "energy",
        title: cut(`تیکت بازدید تأسیسات: ${insight.title}`, 200),
        priority: insight.priority,
        params: {
          title: cut(`بازدید تجهیزات پرمصرف (${insight.title})`, 200),
          category: "hvac",
          priority: high ? "high" : "medium",
          description: cut(insight.recommendation, 2000),
        },
        expectedImpact: impact,
      }];
    case "repeatFailure": {
      const category = String(subject.category ?? "other");
      const where = String(subject.where ?? "");
      return [{
        type: "createTicket",
        department: "maintenance",
        title: cut(`تیکت بررسی ریشه‌ای: ${insight.title}`, 200),
        priority: insight.priority,
        params: {
          title: cut(`بررسی ریشه‌ای خرابی تکراری (${where.replace("room-", "اتاق ")})`, 200),
          category: TICKET_CATEGORIES.indexOf(category) >= 0 ? category : "other",
          priority: high ? "high" : "medium",
          roomNumber: where.startsWith("room-") ? where.slice(5) : "",
          area: where.startsWith("room-") ? "" : where,
          description: cut(insight.recommendation, 2000),
        },
        expectedImpact: impact,
      }];
    }
    case "outOfOrderRooms": {
      const rooms = Array.isArray(subject.rooms) ? (subject.rooms as unknown[]).map(String).slice(0, 20) : [];
      if (!rooms.length) return [];
      return [{
        type: "createTask",
        department: "housekeeping",
        title: cut(`بازدید آماده‌سازی ${rooms.length} اتاق خارج از سرویس`, 200),
        priority: insight.priority,
        params: { taskType: "inspection", rooms, priority: high ? "high" : "normal", notes: "بازدید پس از تعمیر و آماده‌سازی برای بازگشت به فروش" },
        expectedImpact: impact,
      }];
    }
    case "hkEfficiency":
      return [notify("housekeeping", ["housekeepingManager"], insight, impact)];
    case "stockout":
      return [notify("inventory", ["inventoryManager"], insight, impact)];
    case "outOfOrderRevenue":
    case "weekdayOccupancy":
      return [notify("operations", ["generalManager"], insight, impact)];
    default:
      return [];
  }
}

function notify(department: ActionDepartment, roles: string[], insight: InsightLike, impact?: ExpectedImpact): ActionDraft {
  return {
    type: "notifyRole",
    department,
    title: cut(`اطلاع به ${roles.join("، ")}: ${insight.title}`, 200),
    priority: insight.priority,
    params: { roles, title: cut(insight.title, 120), body: cut(insight.recommendation, 500) },
    expectedImpact: impact,
  };
}
