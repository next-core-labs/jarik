import { describe, expect, it } from "vitest";
import { leaseEndDate, leaseSchedule } from "@/components/lease-schedule";

describe("leaseEndDate", () => {
  it("ends the day before the same date a term later", () => {
    expect(leaseEndDate("2026-11-01", 12)).toBe("2027-10-31");
    expect(leaseEndDate("2026-11-15", 6)).toBe("2027-05-14");
    expect(leaseEndDate("2026-11-01", 1)).toBe("2026-11-30");
  });

  it("clamps to the last day of a shorter month, like Postgres", () => {
    expect(leaseEndDate("2027-01-31", 1)).toBe("2027-02-27");
  });
});

describe("leaseSchedule", () => {
  it("splits a yearly lease into equal installments over 365 days", () => {
    expect(
      leaseSchedule({
        startDate: "2026-11-01",
        termMonths: 12,
        annualRent: 36000,
        installments: 4,
      }),
    ).toEqual([
      { amount: 9000, due_date: "2026-11-01" },
      { amount: 9000, due_date: "2027-01-31" },
      { amount: 9000, due_date: "2027-05-03" },
      { amount: 9000, due_date: "2027-08-02" },
    ]);
  });

  it("charges a short lease its share of the annual rent and adds up to the halala", () => {
    const rows = leaseSchedule({
      startDate: "2026-11-01",
      termMonths: 6,
      annualRent: 10000,
      installments: 3,
    });
    expect(rows.map((r) => r.amount)).toEqual([1666.67, 1666.67, 1666.66]);
    expect(rows[0]!.due_date).toBe("2026-11-01");
  });
});
