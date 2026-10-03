import { describe, expect, it } from "vitest";
import { portfolioHealthScore } from "@/lib/portfolio-health";

describe("portfolioHealthScore", () => {
  it("scores a fully-occupied, issue-free portfolio at 100", () => {
    const { score, summary } = portfolioHealthScore({
      occupancyPct: 100,
      overdueCount: 0,
      pendingMaintenanceCount: 0,
      expiringLeasesCount: 0,
    });
    expect(score).toBe(100);
    expect(summary).toContain("ممتازة");
  });

  it("penalizes low occupancy proportionally", () => {
    const { score } = portfolioHealthScore({
      occupancyPct: 50,
      overdueCount: 0,
      pendingMaintenanceCount: 0,
      expiringLeasesCount: 0,
    });
    expect(score).toBe(80); // 100 - (100-50)*0.4
  });

  it("caps the overdue penalty instead of letting it dominate the score", () => {
    const { score, summary } = portfolioHealthScore({
      occupancyPct: 100,
      overdueCount: 10,
      pendingMaintenanceCount: 0,
      expiringLeasesCount: 0,
    });
    expect(score).toBe(70); // penalty capped at 30, not 100
    expect(summary).toContain("10 دفعة متأخرة");
  });

  it("never goes below 0", () => {
    const { score } = portfolioHealthScore({
      occupancyPct: 0,
      overdueCount: 20,
      pendingMaintenanceCount: 20,
      expiringLeasesCount: 20,
    });
    expect(score).toBe(0);
  });

  it("falls into the 'needs urgent attention' band below 60", () => {
    const { summary } = portfolioHealthScore({
      occupancyPct: 20,
      overdueCount: 3,
      pendingMaintenanceCount: 0,
      expiringLeasesCount: 0,
    });
    expect(summary).toContain("عاجلة");
  });
});
