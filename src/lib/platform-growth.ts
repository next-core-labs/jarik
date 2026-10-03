import { todayRiyadh } from "@/lib/dates";

/** آخر N شهر ميلادي، بترتيب زمني — نفس فكرة `lastSixMonths` بـ`owner-dashboard.tsx` لكن معزولة
 * هنا كدالة نقية مختبرة لأن `platformGrowth` بـ`super-admin.functions.ts` تُبنى على الخادم.
 * "الشهر الحالي" يُحدَّد بتقويم الرياض (todayRiyadh) لا بمنطقة الخادم المحلية (UTC غالبًا) — وإلا
 * تسجيل يصل قرب منتصف الليل UTC (فجرًا بالرياض، شهر تالٍ فعليًا) يُحسب بالشهر الخطأ. */
export function lastNMonths(n: number, now: Date = new Date()): { key: string; label: string }[] {
  const [yearStr, monthStr] = todayRiyadh(now).split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - i, 1));
    out.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("ar-SA", { month: "short", timeZone: "UTC" }),
    });
  }
  return out;
}

/** يحصر عدد التسجيلات الجديدة (حسابات) والمكاتب الجديدة لكل شهر من `months`. */
export function bucketGrowth(
  users: { created_at: string | null | undefined }[],
  offices: { created_at: string | null | undefined }[],
  months: { key: string; label: string }[],
): { month: string; signups: number; offices: number }[] {
  const bucketOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : null);
  return months.map((m) => ({
    month: m.label,
    signups: users.filter((u) => bucketOf(u.created_at) === m.key).length,
    offices: offices.filter((o) => bucketOf(o.created_at) === m.key).length,
  }));
}
