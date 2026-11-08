import { addDays } from "@/lib/dates";
import { leaseStatusLabel } from "@/lib/format";
import { splitInstallments } from "@/lib/installments";

/** Quick picks for a lease's length; any whole number of months up to MAX_LEASE_MONTHS is accepted. */
export const LEASE_TERMS = [1, 3, 6, 12, 24] as const;

/** Longest lease the database accepts (leases_term_months_check / private.check_lease_terms). */
export const MAX_LEASE_MONTHS = 60;

/**
 * `start` plus whole calendar months. A day the target month doesn't have becomes its last day
 * (Jan 31 + 1 month → Feb 28), counted from `start` each time, exactly like Postgres
 * `date + interval 'n months'`.
 */
export function addMonths(start: string, months: number): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

/**
 * Last day of a lease that starts on `start` and runs `months` months: start + months − 1 day,
 * so this matches the end date renew_lease computes.
 */
export function leaseEndDate(start: string, months: number): string {
  return addDays(addMonths(start, months), -1);
}

/**
 * The whole months a lease from `start` runs when the office picks `end` as its last day: `end` is
 * start + n months − 1 day (the stored end date), or the same day-of-month n months on (how many
 * contracts are written). Null when `end` doesn't complete whole months, or the term is out of range.
 */
export function leaseTermFromEnd(start: string, end: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start)
    return null;
  const [ys, ms] = start.split("-").map(Number) as [number, number];
  const [ye, me] = end.split("-").map(Number) as [number, number];
  const approx = (ye - ys) * 12 + (me - ms);
  for (const n of [approx, approx + 1, approx - 1]) {
    if (n < 1 || n > MAX_LEASE_MONTHS) continue;
    if (leaseEndDate(start, n) === end || addMonths(start, n) === end) return n;
  }
  return null;
}

/** The whole-month term closest to a hand-picked end date (at least 1, at most MAX_LEASE_MONTHS). */
export function nearestLeaseTerm(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number) as [number, number, number];
  const [ye, me, de] = end.split("-").map(Number) as [number, number, number];
  const months = (ye - ys) * 12 + (me - ms) + (de - ds + 1) / 30;
  return Math.min(MAX_LEASE_MONTHS, Math.max(1, Math.round(months)));
}

/**
 * The payment schedule of a lease, built exactly like private.lease_schedule in the database
 * (used by create_lease, renew_lease and correct_lease): the contract total is the annual rent's
 * share for the term, split into whole halalas (remainder on the last installment). Installment i
 * (0-based) falls due floor(i × term / count) calendar months after the start — monthly on the
 * same day, quarterly every three months — with the month-end clamp of addMonths.
 */
export function leaseSchedule(input: {
  startDate: string;
  termMonths: number;
  annualRent: number;
  installments: number;
}): { amount: number; due_date: string }[] {
  const { startDate, termMonths, annualRent, installments } = input;
  const total = Math.round(((annualRent * termMonths) / 12) * 100) / 100;
  return splitInstallments(total, installments).map((amount, i) => ({
    amount,
    due_date: addMonths(startDate, Math.floor((i * termMonths) / installments)),
  }));
}

/** A lease status in Arabic, including 'renewed' and 'ended' (set by renew_lease / end_lease). */
export function leaseStatusText(status: string): string {
  return (
    leaseStatusLabel[status] ??
    ({ renewed: "مُجدَّد", ended: "منتهي" } as Record<string, string>)[status] ??
    status
  );
}
