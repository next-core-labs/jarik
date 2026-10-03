import { describe, expect, it } from "vitest";

import { splitInstallments } from "./installments";

const sumHalalas = (parts: number[]) => parts.reduce((s, p) => s + Math.round(p * 100), 0);

describe("splitInstallments", () => {
  it("adds up to the rent exactly, with the remainder on the last installment", () => {
    expect(splitInstallments(100000, 3)).toEqual([33333.33, 33333.33, 33333.34]);
    expect(splitInstallments(35000, 12)).toEqual([
      ...Array.from({ length: 11 }, () => 2916.67),
      2916.63,
    ]);
    expect(sumHalalas(splitInstallments(35000, 12))).toBe(3_500_000);
    expect(sumHalalas(splitInstallments(10000, 3))).toBe(1_000_000);
  });

  it("is exact for a single installment and for evenly divisible rents", () => {
    expect(splitInstallments(24000, 1)).toEqual([24000]);
    expect(splitInstallments(24000, 4)).toEqual([6000, 6000, 6000, 6000]);
  });

  it("never drifts from the total across many rents and counts", () => {
    for (const total of [1, 999.99, 12345.67, 48000, 87500.5, 100001]) {
      for (const count of [1, 2, 3, 4, 6, 7, 12]) {
        const parts = splitInstallments(total, count);
        expect(parts).toHaveLength(count);
        expect(sumHalalas(parts)).toBe(Math.round(total * 100));
        // installments differ by at most a few halalas
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThan(0.1);
      }
    }
  });

  it("rejects an invalid installment count", () => {
    expect(() => splitInstallments(1000, 0)).toThrow();
    expect(() => splitInstallments(1000, 2.5)).toThrow();
  });
});
