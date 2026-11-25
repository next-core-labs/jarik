import { addDays, daysBetween } from "@/lib/dates";

/**
 * تقويم الحجز اليومي في لوحة المكتب: شهر كامل يُرى فيه المشغول والمحجوب والحرّ بنظرة واحدة.
 *
 * ليلة لا يوم: الحجز `[دخول، خروج)` يشغل ليالي الدخول حتى ما قبل الخروج، ويوم الخروج نفسه حرّ
 * للضيف التالي — نفس دلالة قيد EXCLUDE في القاعدة. خلط الاثنين هنا يعني تقويمًا يُظهر ليلة
 * مشغولة وهي حرّة، فيردّ المكتب ضيفًا بلا سبب.
 *
 * ميلادي لا هجري: التواريخ المخزَّنة `YYYY-MM-DD` ميلادية، والحساب كله على النصّ بتوقيت الرياض
 * (src/lib/dates.ts) فلا يتغيّر اليوم باختلاف جهاز المستخدم.
 */

/** الحالات التي تشغل الليلة فعلًا — نفس قائمة القاعدة. */
const OCCUPYING = new Set(["pending", "confirmed", "blocked"]);

export type CalendarBooking = {
  id: string;
  unit_id: string;
  from_date: string;
  to_date: string;
  status: string;
  guest_name: string | null;
  unit_label: string;
  nights: number;
};

export type CalendarDay = {
  /** YYYY-MM-DD */
  date: string;
  /** يوم من الشهر المعروض، لا حشوًا من الشهر المجاور. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  /** حجوزات تشغل ليلة هذا اليوم، بحالاتها. */
  confirmed: CalendarBooking[];
  pending: CalendarBooking[];
  blocked: CalendarBooking[];
  /** خروج في صباح هذا اليوم: الليلة نفسها حرّة، والمكتب يحتاج معرفته للتنظيف والاستلام. */
  checkouts: CalendarBooking[];
};

/** «2026-12» من «2026-12-04». */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** الشهر التالي أو السابق بصيغة «YYYY-MM». */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** «ديسمبر 2026» بالميلادي وبأرقام عربية — لا هجري: المخزَّن ميلادي. */
export function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** أسماء الأيام من الأحد (بداية الأسبوع السعودي) إلى السبت. */
export const WEEKDAYS = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] as const;

/** هل يشغل الحجز ليلة هذا اليوم؟ يوم الخروج ليس ليلة مشغولة. */
export function occupiesNight(b: { from_date: string; to_date: string }, date: string): boolean {
  return b.from_date <= date && date < b.to_date;
}

/**
 * شبكة الشهر كاملة: أسابيع تبدأ بالأحد، مع أيام الشهرين المجاورين حشوًا حتى لا تنكسر الصفوف.
 * كل يوم يحمل ما يشغل ليلته من حجوزات — والحجوزات الملغاة والمرفوضة لا تشغل شيئًا.
 */
export function monthGrid(
  month: string,
  bookings: readonly CalendarBooking[],
  today: string,
): CalendarDay[] {
  const first = `${month}-01`;
  const lastDay = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  ).getUTCDate();
  const start = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  const lastWeekday = new Date(`${end}T00:00:00Z`).getUTCDay();
  const gridEnd = addDays(end, 6 - lastWeekday);

  const occupying = bookings.filter((b) => OCCUPYING.has(b.status) && b.from_date && b.to_date);
  const days: CalendarDay[] = [];
  for (let i = 0; i <= daysBetween(start, gridEnd); i += 1) {
    const date = addDays(start, i);
    const nightly = occupying.filter((b) => occupiesNight(b, date));
    days.push({
      date,
      inMonth: date.startsWith(month),
      isToday: date === today,
      isPast: date < today,
      confirmed: nightly.filter((b) => b.status === "confirmed"),
      pending: nightly.filter((b) => b.status === "pending"),
      blocked: nightly.filter((b) => b.status === "blocked"),
      checkouts: occupying.filter((b) => b.to_date === date && b.status !== "blocked"),
    });
  }
  return days;
}

export type MonthTotals = {
  /** ليالٍ مشغولة بحجز مؤكَّد في أيام هذا الشهر. */
  confirmedNights: number;
  pendingNights: number;
  blockedNights: number;
  freeNights: number;
  /** نسبة الإشغال من ليالي الشهر: المؤكَّد وحده، فالمعلّق قد لا يُؤكَّد والمحجوب ليس إيرادًا. */
  occupancyPct: number;
};

/** حصيلة الشهر المعروض — من أيام الشهر نفسه لا من حشو الشبكة. */
export function monthTotals(days: readonly CalendarDay[]): MonthTotals {
  const own = days.filter((d) => d.inMonth);
  const confirmedNights = own.filter((d) => d.confirmed.length > 0).length;
  const pendingNights = own.filter((d) => d.confirmed.length === 0 && d.pending.length > 0).length;
  const blockedNights = own.filter(
    (d) => d.confirmed.length === 0 && d.pending.length === 0 && d.blocked.length > 0,
  ).length;
  return {
    confirmedNights,
    pendingNights,
    blockedNights,
    freeNights: own.length - confirmedNights - pendingNights - blockedNights,
    occupancyPct: own.length === 0 ? 0 : Math.round((confirmedNights / own.length) * 100),
  };
}

/**
 * المدى المختار بالنقر: النقرة الأولى يوم، والثانية تمدّه — والترتيب لا يهمّ (من ٢٣ إلى ٢١ مثل
 * ٢١ إلى ٢٣). المدى شامل الطرفين كما يراه المكتب: «احجب ٢١ و٢٢ و٢٣».
 */
export function selectedRange(
  anchor: string | null,
  second: string | null,
): { from: string; to: string } | null {
  if (!anchor) return null;
  if (!second) return { from: anchor, to: anchor };
  return anchor <= second ? { from: anchor, to: second } : { from: second, to: anchor };
}

/** مدى الحجب كما تخزّنه القاعدة: `[دخول، خروج)` — فآخر يوم مختار ليلة محجوبة هو أيضًا. */
export function rangeToStay(range: { from: string; to: string }): { from: string; to: string } {
  return { from: range.from, to: addDays(range.to, 1) };
}

/** الحجوزات التي تمسّ المدى المختار (تشغل إحدى لياليه) — ما يُعرض تحت التقويم. */
export function bookingsInRange(
  bookings: readonly CalendarBooking[],
  range: { from: string; to: string },
): CalendarBooking[] {
  const stay = rangeToStay(range);
  return bookings
    .filter((b) => OCCUPYING.has(b.status) && b.from_date < stay.to && stay.from < b.to_date)
    .sort((a, b) => a.from_date.localeCompare(b.from_date));
}

/** هل في المدى المختار ليلة مشغولة أصلًا؟ الحجب فوقها يرفضه قيد EXCLUDE، فيُمنع الزر قبله. */
export function rangeHasOccupied(
  bookings: readonly CalendarBooking[],
  range: { from: string; to: string },
): boolean {
  return bookingsInRange(bookings, range).length > 0;
}
