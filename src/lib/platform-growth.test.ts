import { describe, expect, it } from "vitest";
import { bucketGrowth, lastNMonths } from "@/lib/platform-growth";

describe("lastNMonths", () => {
  it("returns n months ending at the reference month, oldest first", () => {
    // Noon UTC on the 15th, well clear of the day boundary in Riyadh time either way.
    const months = lastNMonths(3, new Date("2026-09-15T12:00:00Z")); // September 2026
    expect(months.map((m) => m.key)).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("rolls back across a year boundary", () => {
    const months = lastNMonths(2, new Date("2026-01-01T12:00:00Z")); // January 2026
    expect(months.map((m) => m.key)).toEqual(["2025-12", "2026-01"]);
  });
});

describe("bucketGrowth", () => {
  const months = lastNMonths(2, new Date("2026-09-15T12:00:00Z")); // 2026-08, 2026-09

  it("counts users and offices into the month they were created in", () => {
    const users = [
      { created_at: "2026-08-05T10:00:00Z" },
      { created_at: "2026-09-01T00:00:00Z" },
      { created_at: "2026-09-20T23:00:00Z" },
    ];
    const offices = [{ created_at: "2026-08-30T00:00:00Z" }];

    const result = bucketGrowth(users, offices, months);

    expect(result).toEqual([
      { month: months[0]!.label, signups: 1, offices: 1 },
      { month: months[1]!.label, signups: 2, offices: 0 },
    ]);
  });

  it("ignores rows outside the given months and null created_at", () => {
    const users = [{ created_at: "2025-01-01T00:00:00Z" }, { created_at: null }];
    const result = bucketGrowth(users, [], months);
    expect(result.every((m) => m.signups === 0)).toBe(true);
  });
});
