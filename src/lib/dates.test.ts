import { describe, expect, it } from "vitest";

import {
  addDays,
  addYears,
  daysBetween,
  effectiveStatus,
  isOverdue,
  monthRange,
  toDatetimeLocalValue,
  todayRiyadh,
} from "./dates";

describe("toDatetimeLocalValue", () => {
  it("round-trips a local wall-clock time regardless of the machine's time zone", () => {
    const local = new Date(2026, 8, 20, 10, 5); // 10:05 local
    expect(toDatetimeLocalValue(local.toISOString())).toBe("2026-09-20T10:05");
    expect(toDatetimeLocalValue(new Date(2026, 0, 3, 0, 0).toISOString())).toBe("2026-01-03T00:00");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue(undefined)).toBe("");
    expect(toDatetimeLocalValue("not a date")).toBe("");
  });
});

describe("effectiveStatus", () => {
  it("shows unpaid past-due payments as overdue and leaves the rest alone", () => {
    expect(effectiveStatus({ status: "due", due_date: "2026-09-01" }, "2026-09-20")).toBe(
      "overdue",
    );
    expect(effectiveStatus({ status: "due", due_date: "2026-09-30" }, "2026-09-20")).toBe("due");
    expect(effectiveStatus({ status: "paid", due_date: "2026-01-01" }, "2026-09-20")).toBe("paid");
  });
});

describe("todayRiyadh", () => {
  it("uses the Saudi calendar day, not the UTC day", () => {
    // 22:00Z on the 19th is 01:00 on the 20th in Riyadh.
    expect(todayRiyadh(new Date("2026-09-19T22:00:00Z"))).toBe("2026-09-20");
    expect(todayRiyadh(new Date("2026-09-20T20:59:59Z"))).toBe("2026-09-20");
    expect(todayRiyadh(new Date("2026-09-20T21:00:00Z"))).toBe("2026-09-21");
  });

  it("rolls the month correctly at the Saudi midnight", () => {
    expect(todayRiyadh(new Date("2026-09-30T21:30:00Z"))).toBe("2026-10-01");
  });
});

describe("addYears", () => {
  it("keeps the day and month, clamping Feb 29 in non-leap years", () => {
    expect(addYears("2026-10-01", 1)).toBe("2027-10-01");
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2028-02-29", 4)).toBe("2032-02-29");
    expect(addYears("2026-12-31", 1)).toBe("2027-12-31");
  });

  it("gives a lease that ends the day before its anniversary, so renewals do not drift", () => {
    const end = (start: string) => addDays(addYears(start, 1), -1);
    expect(end("2026-10-01")).toBe("2027-09-30");
    expect(addDays(end("2026-10-01"), 1)).toBe("2027-10-01"); // next lease starts on the anniversary
    expect(daysBetween("2026-10-01", end("2026-10-01")) + 1).toBe(365);
  });
});

describe("addDays / daysBetween", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-09-20", 7)).toBe("2026-09-27");
  });

  it("counts whole calendar days with the right sign", () => {
    expect(daysBetween("2026-09-20", "2026-09-20")).toBe(0);
    expect(daysBetween("2026-09-20", "2026-09-27")).toBe(7);
    expect(daysBetween("2026-09-20", "2026-09-19")).toBe(-1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("monthRange", () => {
  const now = new Date("2026-09-20T10:00:00Z");

  it("returns the first and last day of the current, next and previous months", () => {
    expect(monthRange(0, now)).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthRange(1, now)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(monthRange(-1, now)).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("wraps across years and handles leap February", () => {
    expect(monthRange(-9, now)).toEqual({ start: "2025-12-01", end: "2025-12-31" });
    expect(monthRange(4, now)).toEqual({ start: "2027-01-01", end: "2027-01-31" });
    expect(monthRange(0, new Date("2028-02-10T10:00:00Z"))).toEqual({
      start: "2028-02-01",
      end: "2028-02-29",
    });
  });

  it("uses the Saudi month at the boundary (01:00 on Oct 1 Riyadh is still Sep 30 UTC)", () => {
    expect(monthRange(0, new Date("2026-09-30T22:00:00Z"))).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });
});

describe("isOverdue", () => {
  it("is overdue only when unpaid and strictly past due", () => {
    expect(isOverdue({ status: "due", due_date: "2026-09-19" }, "2026-09-20")).toBe(true);
    expect(isOverdue({ status: "due", due_date: "2026-09-20" }, "2026-09-20")).toBe(false);
    expect(isOverdue({ status: "due", due_date: "2026-09-21" }, "2026-09-20")).toBe(false);
    expect(isOverdue({ status: "paid", due_date: "2026-01-01" }, "2026-09-20")).toBe(false);
    expect(isOverdue({ status: "partial", due_date: "2026-09-01" }, "2026-09-20")).toBe(true);
  });
});
