import { arCount } from "@/lib/format";

export type PortfolioHealthInput = {
  occupancyPct: number;
  overdueCount: number;
  pendingMaintenanceCount: number;
  expiringLeasesCount: number;
};

export type PortfolioHealth = {
  score: number;
  summary: string;
};

/**
 * A single 0-100 "at a glance" score for the owner dashboard, computed entirely from numbers the
 * page already fetches (occupancy, overdue payments, pending maintenance approvals, leases ending
 * within 60 days) — no new queries. Weighted so a fully-occupied, on-time portfolio scores 100.
 */
export function portfolioHealthScore(input: PortfolioHealthInput): PortfolioHealth {
  const { occupancyPct, overdueCount, pendingMaintenanceCount, expiringLeasesCount } = input;

  let score = 100;
  score -= (100 - occupancyPct) * 0.4;
  score -= Math.min(30, overdueCount * 10);
  score -= Math.min(15, pendingMaintenanceCount * 5);
  score -= Math.min(15, expiringLeasesCount * 3);
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Number agreement and Arabic-Indic digits, matching the money figures beside this text.
  const issues: string[] = [];
  if (overdueCount > 0) {
    issues.push(
      arCount(overdueCount, {
        one: "دفعة متأخرة",
        two: "دفعتان متأخرتان",
        few: "دفعات متأخرة",
        many: "دفعة متأخرة",
      }),
    );
  }
  if (pendingMaintenanceCount > 0) {
    issues.push(
      arCount(pendingMaintenanceCount, {
        one: "صيانة بانتظار موافقتك",
        two: "صيانتان بانتظار موافقتك",
        few: "طلبات صيانة بانتظار موافقتك",
        many: "طلب صيانة بانتظار موافقتك",
      }),
    );
  }
  if (expiringLeasesCount > 0) {
    issues.push(
      arCount(expiringLeasesCount, {
        one: "عقد ينتهي قريبًا",
        two: "عقدان ينتهيان قريبًا",
        few: "عقود تنتهي قريبًا",
        many: "عقدًا ينتهي قريبًا",
      }),
    );
  }
  const issuesText = issues.join(" و");

  let summary: string;
  if (score >= 85) {
    summary = issues.length
      ? `بصحة ممتازة — تنبّه فقط لـ${issuesText}.`
      : "محفظتك بصحة ممتازة، لا شيء يحتاج متابعة الآن.";
  } else if (score >= 60) {
    summary = `بصحة جيدة، لكن يحتاج انتباهك: ${issuesText || "نسبة الإشغال"}.`;
  } else {
    summary = `تحتاج متابعة عاجلة: ${issuesText || "انخفاض نسبة الإشغال"}.`;
  }

  return { score, summary };
}
