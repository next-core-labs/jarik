import { addDays, daysBetween } from "@/lib/dates";
import { splitInstallments } from "@/lib/installments";

/** Lease terms the database accepts (leases_term_months_check). */
export const LEASE_TERMS = [1, 3, 6, 12] as const;

/**
 * Last day of a lease that starts on `start` and runs `months` months: start + months − 1 day.
 * A month that has no such day ends on its last day (Jan 31 + 1 month → Feb 28), as in Postgres,
 * so this matches the end date renew_lease computes.
 */
export function leaseEndDate(start: string, months: number): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
  return addDays(target.toISOString().slice(0, 10), -1);
}

/**
 * The payment schedule of a new lease, built exactly like renew_lease builds a renewal's: the
 * contract total is the annual rent's share for the term, split into whole halalas (remainder on
 * the last installment), with due dates spread evenly from the start date (over 365 days for a
 * yearly lease, otherwise over the term's actual days).
 */
export function leaseSchedule(input: {
  startDate: string;
  termMonths: number;
  annualRent: number;
  installments: number;
}): { amount: number; due_date: string }[] {
  const { startDate, termMonths, annualRent, installments } = input;
  const total = Math.round(((annualRent * termMonths) / 12) * 100) / 100;
  const span =
    termMonths === 12 ? 365 : daysBetween(startDate, leaseEndDate(startDate, termMonths)) + 1;
  return splitInstallments(total, installments).map((amount, i) => ({
    amount,
    due_date: addDays(startDate, Math.round((i * span) / installments)),
  }));
}
