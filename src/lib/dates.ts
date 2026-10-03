/**
 * Calendar-date helpers pinned to Saudi time (Asia/Riyadh, UTC+3, no DST).
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is still "yesterday" between
 * 00:00 and 03:00 in Riyadh. A payment recorded at 01:00 on the 1st would land in the previous
 * month. Dates in this app are plain `YYYY-MM-DD` strings, so the arithmetic below is done on
 * those strings (UTC midnight) and never depends on the viewer's time zone.
 */

const RIYADH = "Asia/Riyadh";

/** Today's calendar date (YYYY-MM-DD) in Saudi time. */
export function todayRiyadh(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: RIYADH });
}

/**
 * Value for an `<input type="datetime-local">` from a stored ISO timestamp, in the viewer's local
 * time. (`toISOString().slice(0, 16)` is UTC, so a visit saved for 10:00 in Riyadh was shown as
 * 07:00, and re-saving after editing only the minutes moved it three hours earlier each time.)
 */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Add whole years to a YYYY-MM-DD string; Feb 29 becomes Feb 28 in a non-leap target year. */
export function addYears(iso: string, years: number): string {
  const [yearPart, monthPart, dayPart] = iso.split("-");
  const month = Number(monthPart);
  const d = new Date(Date.UTC(Number(yearPart) + years, month - 1, Number(dayPart)));
  // Date.UTC rolls Feb 29 over into March in a non-leap year; step back to the last day of Feb.
  if (d.getUTCMonth() !== month - 1) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** First and last day of the month `offset` months away from the current Saudi month. */
export function monthRange(offset = 0, now: Date = new Date()): { start: string; end: string } {
  const [yearPart, monthPart] = todayRiyadh(now).split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

/**
 * A payment that is not paid and whose due date has passed. Nothing in the app ever writes
 * `status = 'overdue'`, so overdue-ness has to be derived from the due date.
 */
export function isOverdue(
  payment: { status: string; due_date: string },
  today: string = todayRiyadh(),
): boolean {
  return payment.status !== "paid" && payment.due_date < today;
}

/** Status to show in the UI: an unpaid payment past its due date is displayed as "overdue". */
export function effectiveStatus(
  payment: { status: string; due_date: string },
  today: string = todayRiyadh(),
): string {
  return isOverdue(payment, today) ? "overdue" : payment.status;
}
