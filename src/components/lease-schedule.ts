import { addDays } from "@/lib/dates";
import { leaseStatusLabel } from "@/lib/format";
import { splitInstallments } from "@/lib/installments";

/** Lease terms the database accepts (leases_term_months_check). */
export const LEASE_TERMS = [1, 3, 6, 12] as const;

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
