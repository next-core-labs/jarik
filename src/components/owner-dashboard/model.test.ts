import { describe, expect, it } from "vitest";

import {
  addMonths,
  deriveDashboard,
  monthLabel,
  rentAdvice,
} from "@/components/owner-dashboard/model";
import { OWNER_FIXTURE, fixtureDaysUntil } from "@/lib/__testutils__/owner-dashboard-fixture";

const model = deriveDashboard(OWNER_FIXTURE, fixtureDaysUntil);

describe("deriveDashboard", () => {
  it("leaves sold units out of occupancy", () => {
    expect(model.rentable).toBe(7);
    expect(model.occupied).toBe(5);
    expect(model.occupancyPct).toBe(71);
  });

  it("orders attention by severity, then approvals → money → leases → vacancies", () => {
    expect(model.attention.map((i) => i.key)).toEqual([
      "approval-m1", // urgent approval
      "overdue",
      "lease-u3", // ended 6 days ago, still active
      "approval-m2",
      "lease-u2", // 16 days left
      "lease-u6", // 52 days left
      "vacant",
    ]);
  });

  it("flags an expired-but-active lease as critical and keeps leases beyond 60 days out", () => {
    const leases = model.attention.filter((i) => i.kind === "lease");
    expect(
      leases.map((l) => (l.kind === "lease" ? [l.unit.unit_number, l.days, l.severity] : null)),
    ).toEqual([
      ["201", -6, "critical"],
      ["102", 16, "warning"],
      ["م-1", 52, "info"],
    ]);
  });

  it("groups units by property with per-property occupancy and the 12-month return", () => {
    expect(
      model.properties.map((p) => [
        p.name,
        p.occupied,
        p.rentable,
        p.occupancyPct,
        p.returns?.net_12m,
      ]),
    ).toEqual([
      ["عمارة الملقا", 3, 4, 75, 72800],
      ["مجمع النرجس التجاري", 1, 2, 50, 100050],
      ["برج الياسمين", 1, 1, 100, 23000],
    ]);
  });

  it("benchmarks only districts the owner has units in, like-for-like on asking rent", () => {
    expect(
      model.benchmarks.map((b) => [
        b.district,
        b.myUnits,
        b.myAvgRent,
        b.marketAvgRent,
        b.deltaPct,
      ]),
    ).toEqual([
      ["الملقا", 4, 37000, 34800, 6],
      ["النرجس", 2, 82500, 91000, -9],
    ]);
  });

  it("computes net income, contracted rent and the chart with the current month last", () => {
    expect(model.net12m).toBe(195850);
    expect(model.contractedRent).toBe(221000);
    expect(model.chartTotal).toBe(142000);
    expect(model.chart.filter((p) => p.current).map((p) => p.key)).toEqual(["2026-10"]);
  });

  it("feeds the health score with overdue, approvals and all flagged leases", () => {
    // 100 − (100−71)×0.4 − 2×10 − 2×5 − 3×3 = 49.4
    expect(model.health.score).toBe(49);
  });

  it("returns an empty, zero-safe model for an owner with no units", () => {
    const empty = deriveDashboard(
      {
        ...OWNER_FIXTURE,
        units: [],
        approvals: [],
        returns: [],
        finance: { ...OWNER_FIXTURE.finance, overdue_count: 0 },
      },
      fixtureDaysUntil,
    );
    expect(empty.hasUnits).toBe(false);
    expect(empty.occupancyPct).toBe(0);
    expect(empty.attention).toEqual([]);
    expect(empty.benchmarks).toEqual([]);
  });
});

describe("deriveDashboard — map, statuses and renewals", () => {
  it("attaches coordinates per property and leaves unplaced ones without", () => {
    expect(model.properties.map((p) => [p.id, p.location !== null])).toEqual([
      ["p-malqa", true],
      ["p-narjis", true],
      ["p-yasmin", false],
    ]);
  });

  it("counts units per status, sold included", () => {
    expect(model.unitsCount).toBe(8);
    expect(model.statusCounts).toEqual({ occupied: 5, vacant: 2, sold: 1 });
  });

  it("computes the net margin on what was collected", () => {
    // (214,500 − 18,650) / 214,500 = 91.3%
    expect(model.netMarginPct).toBe(91);
  });

  it("buckets lease ends by month, expired-but-active first, over 12 months from today", () => {
    expect(model.renewals[0]).toMatchObject({ key: "expired", rent: 38000 });
    expect(model.renewals).toHaveLength(13);
    expect(model.renewals[1]!.key).toBe("2026-10");
    expect(model.renewals[12]!.key).toBe("2027-09");
    const byKey = Object.fromEntries(
      model.renewals.map((b) => [b.key, b.units.map((u) => u.unit_number)]),
    );
    expect(byKey["2026-10"]).toEqual(["102"]);
    expect(byKey["2026-11"]).toEqual(["م-1"]);
    expect(byKey["2027-03"]).toEqual(["101"]);
    expect(byKey["2027-06"]).toEqual(["12"]);
    expect(model.renewalsRent).toBe(38000 + 34000 + 85000 + 36000 + 28000);
  });

  it("has no expired bucket when every lease is current", () => {
    const current = deriveDashboard(
      { ...OWNER_FIXTURE, units: OWNER_FIXTURE.units.filter((u) => u.unit_id !== "u3") },
      fixtureDaysUntil,
    );
    expect(current.renewals[0]!.key).toBe("2026-10");
    expect(current.renewals).toHaveLength(12);
  });
});

describe("deriveDashboard — expenses, forecast, vacancies, decisions", () => {
  it("groups expenses by category, biggest first, blanks under أخرى", () => {
    expect(model.expenseCategories).toEqual([
      { category: "صيانة", total: 11200, count: 2 },
      { category: "أخرى", total: 5000, count: 1 },
      { category: "كهرباء ومياه", total: 2450, count: 1 },
    ]);
    expect(model.expensesTotal).toBe(18650);
  });

  it("marks this month in the forecast and sums what is still to collect", () => {
    expect(model.forecast[0]).toMatchObject({ key: "2026-10", current: true });
    expect(model.forecast.filter((p) => p.current)).toHaveLength(1);
    expect(model.forecastOutstanding).toBe(38750 - 8500 + 30250 + 9000 + 38250 + 17000);
  });

  it("lists vacant units longest-vacant first, with days and advice", () => {
    expect(model.vacancies.map((v) => [v.unit.unit_number, v.daysVacant])).toEqual([
      ["202", 95],
      ["م-2", 14],
    ]);
    // 40,000 asked vs 35,200 for similar units (+14%), vacant 95 days → lower to 35,000.
    expect(model.vacancies[0]!.advice).toEqual({ kind: "lower", target: 35000 });
    expect(model.vacancies[0]!.deltaPct).toBe(14);
    expect(model.vacancies[1]!.advice).toEqual({ kind: "unknown" });
  });

  it("indexes renewal decisions by lease, and is null when unavailable", () => {
    expect(model.renewalDecisions?.get("l2")?.owner_decision).toBe("renew_new_rent");
    expect(model.renewalDecisions?.get("l6")?.tenant_decision).toBe("leave");
    const without = deriveDashboard({ ...OWNER_FIXTURE, renewalDecisions: null }, fixtureDaysUntil);
    expect(without.renewalDecisions).toBeNull();
  });
});

describe("rentAdvice", () => {
  it("only advises lowering after a month vacant", () => {
    expect(rentAdvice(40000, 35000, 10)).toEqual({ kind: "hold" });
    expect(rentAdvice(40000, 35000, 30)).toEqual({ kind: "lower", target: 35000 });
  });
  it("advises raising when well under similar units", () => {
    expect(rentAdvice(30000, 35200, 5)).toEqual({ kind: "raise", target: 35000 });
    expect(rentAdvice(33000, 35000, 5)).toEqual({ kind: "hold" });
  });
  it("gives no advice without a peer average", () => {
    expect(rentAdvice(30000, null, 90)).toEqual({ kind: "unknown" });
  });
});

describe("addMonths", () => {
  it("rolls over year ends", () => {
    expect(addMonths("2026-10", 3)).toBe("2027-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", 0)).toBe("2026-01");
  });
});

describe("monthLabel", () => {
  it("names Gregorian months, never Hijri", () => {
    expect(monthLabel("2026-10", "long")).toBe("أكتوبر");
    expect(monthLabel("2026-05", "long")).toBe("مايو");
  });
});
