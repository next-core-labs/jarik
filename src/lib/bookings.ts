import type { Locale } from "@/lib/i18n";

/**
 * الحجز اليومي. القاعدة هي مصدر الحقيقة في كل ما يخص المال والإتاحة: quote_booking تحتسب السعر
 * وتقول هل التواريخ متاحة، و create_booking_request تعيد الاحتساب عند الإنشاء، وقيد EXCLUDE يرفض
 * التزاحم. ما في هذا الملف مساعدات عرض فقط — لا يُحتسب هنا سعر يُعتمد عليه.
 */

/** ليلة نهاية الأسبوع = ليلة تبدأ الخميس أو الجمعة — نفس تعريف quote_booking في القاعدة. */
export const WEEKEND_NIGHT_DOW = [4, 5] as const;

export type BookingStatus =
  "pending" | "confirmed" | "blocked" | "rejected" | "cancelled" | "completed";

const STATUS_LABEL: Record<BookingStatus, Record<Locale, string>> = {
  pending: { ar: "بانتظار التأكيد", en: "Awaiting confirmation" },
  confirmed: { ar: "مؤكَّد", en: "Confirmed" },
  blocked: { ar: "محجوب", en: "Blocked" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
  completed: { ar: "منتهٍ", en: "Completed" },
};

export function bookingStatusLabel(status: BookingStatus, locale: Locale = "ar"): string {
  return STATUS_LABEL[status][locale];
}

export function isBookingStatus(v: unknown): v is BookingStatus {
  return typeof v === "string" && v in STATUS_LABEL;
}

/** الحالات التي تشغل التواريخ فعلًا — نفس قائمة قيد EXCLUDE في القاعدة. */
export const OCCUPYING_STATUSES: readonly BookingStatus[] = ["pending", "confirmed", "blocked"];

export function occupiesDates(status: BookingStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

/** يوم بصيغة YYYY-MM-DD بتوقيت محلي (لا UTC: «اليوم» للضيف هو يومه لا يوم غرينتش). */
export function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}

/** عدد الليالي بين تاريخين (المدى `[دخول، خروج)`) — 0 أو أقل يعني مدى غير صالح. */
export function nightsBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = Date.parse(`${from}T00:00:00`);
  const b = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export type BookedRange = { from_date: string; to_date: string };

/**
 * هل يتزاحم المدى المختار مع ليلة مشغولة؟ بنفس دلالة `[)`: مدى ينتهي يوم بدء آخر لا يتزاحم معه.
 * هذا تحقّق واجهة لتعطيل الزر مبكرًا — القاعدة هي من يرفض فعلًا.
 */
export function overlapsBooked(from: string, to: string, booked: BookedRange[]): boolean {
  if (nightsBetween(from, to) <= 0) return false;
  return booked.some((b) => from < b.to_date && b.from_date < to);
}

/** كل الليالي المشغولة كمجموعة تواريخ — لتظليل التقويم. يوم الخروج ليس ليلة مشغولة. */
export function bookedNights(booked: BookedRange[]): Set<string> {
  const nights = new Set<string>();
  for (const b of booked) {
    for (let d = b.from_date; d < b.to_date; d = addDays(d, 1)) nights.add(d);
  }
  return nights;
}

/** «الخميس 20 نوفمبر» — تاريخ مقروء للضيف. */
export function stayLabel(from: string, to: string, locale: Locale = "ar"): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale === "en" ? "en-GB" : "ar-SA", {
      day: "numeric",
      month: "long",
    });
  return `${fmt(from)} → ${fmt(to)}`;
}
