import { describe, expect, it } from "vitest";

import {
  BLOCKERS,
  BLOCKERS_FROM_DB,
  blockerInfo,
  funnelSteps,
  MAX_AUTO_REMINDERS,
  reminderNote,
  type ActivationRow,
} from "./office-activation";

const row = (over: Partial<ActivationRow> = {}): ActivationRow => ({
  id: "o1",
  company_name: "مكتب تجريبي",
  created_at: "2026-11-01T00:00:00Z",
  manager_email: null,
  office_phone: null,
  whatsapp_number: null,
  city: "الرياض",
  district: "الملقا",
  verified: true,
  listed_publicly: true,
  units: 10,
  vacant: 4,
  vacant_priced: 3,
  listed: 2,
  live: 2,
  live_with_photos: 1,
  blocker: null,
  reminders_sent: 0,
  last_reminder_at: null,
  ...over,
});

describe("BLOCKERS", () => {
  // العقد مع القاعدة: كل قيمة تُرجعها private.office_activation_rows لها شرح وإجراء.
  it("explains every blocker the database can return", () => {
    for (const b of BLOCKERS_FROM_DB) {
      expect(BLOCKERS[b], b).toBeDefined();
      expect(BLOCKERS[b].label.length).toBeGreaterThan(0);
      expect(BLOCKERS[b].todo.length).toBeGreaterThan(0);
    }
    expect(Object.keys(BLOCKERS).sort()).toEqual([...BLOCKERS_FROM_DB].sort());
  });

  it("marks only the platform-fixable blocker as an action", () => {
    const actions = BLOCKERS_FROM_DB.filter((b) => BLOCKERS[b].tone === "action");
    expect(actions).toEqual(["not_verified"]);
  });
});

describe("blockerInfo", () => {
  it("returns null for an office that is already publishing", () => {
    expect(blockerInfo(null)).toBeNull();
  });

  it("falls back to «سبب غير محدّد» for a value this build does not know", () => {
    expect(blockerInfo("some_future_blocker")).toBe(BLOCKERS.other);
  });

  it("reads a known blocker", () => {
    expect(blockerInfo("no_price")).toBe(BLOCKERS.no_price);
  });
});

describe("funnelSteps", () => {
  it("shows the path to a visible listing in order", () => {
    expect(funnelSteps(row())).toEqual([
      ["وحدات", 10],
      ["شاغرة", 4],
      ["بسعر", 3],
      ["منشورة", 2],
      ["تظهر للزائر", 2],
    ]);
  });

  it("puts a zero exactly where the office stops — «بسعر» for unpriced vacancies", () => {
    const steps = funnelSteps(row({ vacant_priced: 0, listed: 0, live: 0, blocker: "no_price" }));
    expect(steps.findIndex(([, n]) => n === 0)).toBe(2);
  });
});

describe("reminderNote", () => {
  const cold = (over: Partial<ActivationRow> = {}) =>
    row({
      blocker: "no_units",
      units: 0,
      vacant: 0,
      vacant_priced: 0,
      listed: 0,
      live: 0,
      ...over,
    });

  it("applies only to the office that has not entered any unit", () => {
    // بقية العقبات تحتاج تواصلًا بشريًا — لا تذكير تلقائي لها.
    expect(reminderNote(row({ blocker: "no_price" }))).toBeNull();
    expect(reminderNote(row({ blocker: "not_verified" }))).toBeNull();
    expect(reminderNote(row({ blocker: null }))).toBeNull();
    expect(reminderNote(cold())).not.toBeNull();
  });

  it("waits out the first three days before promising a reminder", () => {
    const fresh = cold({ created_at: new Date().toISOString(), reminders_sent: 0 });
    expect(reminderNote(fresh)).toContain("بعد 3 أيام");
    const due = cold({
      created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      reminders_sent: 0,
    });
    expect(reminderNote(due)).toContain("تشغيل الغد");
  });

  it("counts what is left, and says when the automation is done", () => {
    expect(reminderNote(cold({ reminders_sent: 1 }))).toContain("ويتبقّى 2");
    expect(reminderNote(cold({ reminders_sent: 2 }))).toContain("ويتبقّى 1");
    const done = reminderNote(cold({ reminders_sent: MAX_AUTO_REMINDERS }))!;
    expect(done).toContain("انتهت التذكيرات");
    expect(done).toContain("تواصلًا بشريًا");
  });

  it("never promises more reminders than the cron will send", () => {
    // لو زاد العدد المخزَّن (عدة مديرين للمكتب) لا يصير المتبقي سالبًا.
    expect(reminderNote(cold({ reminders_sent: 9 }))).toContain("انتهت التذكيرات");
  });
});
