import { describe, expect, it } from "vitest";
import { calculateMortgage } from "@/lib/mortgage";

describe("calculateMortgage", () => {
  it("computes a standard amortizing payment", () => {
    // 1,000,000 price, 20% down -> 800,000 principal, 5%/yr, 20 years.
    const r = calculateMortgage({
      price: 1_000_000,
      downPaymentPct: 20,
      annualRatePct: 5,
      years: 20,
    });
    expect(r.downPayment).toBe(200_000);
    expect(r.principal).toBe(800_000);
    // Known amortization result for these inputs (~5,279.65/month).
    expect(r.monthlyPayment).toBeCloseTo(5279.65, 1);
    expect(r.totalPayment).toBeGreaterThan(r.principal);
    expect(r.totalInterest).toBeCloseTo(r.totalPayment - r.principal, 5);
  });

  it("degrades to a flat split at 0% interest", () => {
    const r = calculateMortgage({ price: 120_000, downPaymentPct: 0, annualRatePct: 0, years: 10 });
    expect(r.monthlyPayment).toBeCloseTo(1000, 5); // 120,000 / 120 months
    expect(r.totalInterest).toBeCloseTo(0, 5);
  });

  it("clamps an out-of-range down payment percentage", () => {
    const over = calculateMortgage({
      price: 500_000,
      downPaymentPct: 150,
      annualRatePct: 5,
      years: 15,
    });
    expect(over.downPayment).toBe(500_000);
    expect(over.principal).toBe(0);

    const under = calculateMortgage({
      price: 500_000,
      downPaymentPct: -10,
      annualRatePct: 5,
      years: 15,
    });
    expect(under.downPayment).toBe(0);
    expect(under.principal).toBe(500_000);
  });
});
