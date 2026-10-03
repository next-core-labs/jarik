import { daysBetween, todayRiyadh } from "@/lib/dates";

/** Whole riyals when the amount is whole, halalas (up to 2 decimals) when it is not. */
export function sar(amount: number | null | undefined) {
  const value = Number(amount ?? 0);
  return `${value.toLocaleString("ar-SA", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ر.س`;
}

/** Always two decimals — for tax invoices, where lines must match the QR to the halala. */
export function sar2(amount: number | null | undefined) {
  const value = Number(amount ?? 0);
  return `${value.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
}

export function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  // Pinned to Riyadh, not the viewer's local timezone — a date-only string stored as UTC midnight
  // would otherwise render a day early for any viewer west of UTC. See src/lib/dates.ts.
  return new Date(value).toLocaleDateString("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Riyadh",
  });
}

export const unitStatusLabel: Record<string, string> = {
  vacant: "شاغرة",
  occupied: "مشغولة",
  maintenance: "تحت الصيانة",
  sold: "مباعة",
};

export const paymentStatusLabel: Record<string, string> = {
  due: "مستحقة",
  paid: "مدفوعة",
  overdue: "متأخرة",
  partial: "جزئية",
};

export const maintenanceStatusLabel: Record<string, string> = {
  new: "جديد",
  in_progress: "جاري",
  done: "منجز",
  cancelled: "ملغي",
};

export const priorityLabel: Record<string, string> = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  urgent: "عاجلة",
};

export const dealStageLabel: Record<string, string> = {
  lead: "عميل محتمل",
  contacted: "تم التواصل",
  viewing: "معاينة",
  negotiation: "تفاوض",
  won: "مكتملة",
  lost: "خسارة",
};

export const leaseStatusLabel: Record<string, string> = {
  active: "ساري",
  expired: "منتهي",
  terminated: "مفسوخ",
  draft: "مسودة",
};

/** Whole calendar days from today (Saudi time) to a YYYY-MM-DD date; negative once it has passed. */
export function daysUntil(date: string) {
  return daysBetween(todayRiyadh(), date.slice(0, 10));
}
