import { describe, expect, it } from "vitest";
import {
  addMonths,
  leaseEndDate,
  annualRentFromInput,
  leaseSchedule,
  rentInputFromAnnual,
  leaseTermFromEnd,
} from "@/components/lease-schedule";

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

describe("addMonths", () => {
  it("clamps to month end from the start each time, like Postgres", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("leaseSchedule", () => {
  it("puts quarterly installments on the same day every three months", () => {
    expect(
      leaseSchedule({
        startDate: "2026-11-01",
        termMonths: 12,
        annualRent: 36000,
        installments: 4,
      }),
    ).toEqual([
      { amount: 9000, due_date: "2026-11-01" },
      { amount: 9000, due_date: "2027-02-01" },
      { amount: 9000, due_date: "2027-05-01" },
      { amount: 9000, due_date: "2027-08-01" },
    ]);
  });

  it("has exactly one monthly installment in every month", () => {
    const rows = leaseSchedule({
      startDate: "2027-03-01",
      termMonths: 12,
      annualRent: 60000,
      installments: 12,
    });
    expect(rows.map((r) => r.due_date)).toEqual([
      "2027-03-01",
      "2027-04-01",
      "2027-05-01",
      "2027-06-01",
      "2027-07-01",
      "2027-08-01",
      "2027-09-01",
      "2027-10-01",
      "2027-11-01",
      "2027-12-01",
      "2028-01-01",
      "2028-02-01",
    ]);
  });

  it("keeps a month-end start on each month's last day", () => {
    const rows = leaseSchedule({
      startDate: "2027-01-31",
      termMonths: 3,
      annualRent: 12000,
      installments: 3,
    });
    expect(rows.map((r) => r.due_date)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("spreads an uneven count over whole months", () => {
    const rows = leaseSchedule({
      startDate: "2026-11-01",
      termMonths: 12,
      annualRent: 50000,
      installments: 5,
    });
    expect(rows.map((r) => r.due_date)).toEqual([
      "2026-11-01",
      "2027-01-01",
      "2027-03-01",
      "2027-06-01",
      "2027-08-01",
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
    expect(rows.map((r) => r.due_date)).toEqual(["2026-11-01", "2027-01-01", "2027-03-01"]);
  });
});

describe("leaseTermFromEnd", () => {
  it("reads the stored end (start + n months − 1 day) and the same-day form", () => {
    expect(leaseTermFromEnd("2026-12-08", "2027-12-07")).toBe(12);
    expect(leaseTermFromEnd("2026-12-08", "2027-12-08")).toBe(12);
    expect(leaseTermFromEnd("2026-12-08", "2028-12-07")).toBe(24);
    expect(leaseTermFromEnd("2026-01-31", "2026-02-27")).toBe(1);
    expect(leaseTermFromEnd("2026-12-08", "2027-03-07")).toBe(3);
  });

  it("refuses ends that are not whole months, before the start, or too long", () => {
    expect(leaseTermFromEnd("2026-12-08", "2027-01-20")).toBeNull();
    expect(leaseTermFromEnd("2026-12-08", "2026-12-01")).toBeNull();
    expect(leaseTermFromEnd("2026-12-08", "2036-12-07")).toBeNull();
    expect(leaseTermFromEnd("", "2027-12-07")).toBeNull();
  });
});

describe("short leases and the deposit", () => {
  it("collects what was typed for a one-month lease in a single payment", () => {
    const annualRent = annualRentFromInput(1500, 1);
    expect(annualRent).toBe(18000);
    expect(rentInputFromAnnual(annualRent, 1)).toBe(1500);
    expect(
      leaseSchedule({ startDate: "2026-11-19", termMonths: 1, annualRent, installments: 1 }),
    ).toEqual([{ amount: 1500, due_date: "2026-11-19" }]);
  });

  it("gives back the typed term rent for every short term", () => {
    for (let term = 1; term < 12; term++) {
      for (const typed of [1500, 10000, 3333.33, 0.01]) {
        const annualRent = annualRentFromInput(typed, term);
        expect(rentInputFromAnnual(annualRent, term)).toBe(typed);
        const rows = leaseSchedule({
          startDate: "2026-01-01",
          termMonths: term,
          annualRent,
          installments: 1,
        });
        expect(rows[0]?.amount).toBe(typed);
      }
    }
  });

  it("keeps a yearly figure for a year or longer", () => {
    expect(annualRentFromInput(36000, 12)).toBe(36000);
    expect(annualRentFromInput(36000, 24)).toBe(36000);
  });

  it("adds the deposit to the first installment only", () => {
    const rows = leaseSchedule({
      startDate: "2026-11-01",
      termMonths: 12,
      annualRent: 36000,
      installments: 4,
      deposit: 2000,
    });
    expect(rows.map((r) => r.amount)).toEqual([11000, 9000, 9000, 9000]);
  });
});
