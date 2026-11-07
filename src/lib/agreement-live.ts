import { todayRiyadh } from "@/lib/dates";

/** What decides whether a management agreement is in force. */
export type AgreementTerm = {
  status: string;
  start_date: string;
  end_date: string | null;
  termination_requested_at: string | null;
  notice_period_days: number;
};

/**
 * Where an agreement stands, by the same rule as private.agreement_live() in the database: signed
 * (`active`), Riyadh today between start_date and end_date, and any termination notice not yet served.
 * - pending: sent / office_modified, waiting for an answer
 * - upcoming: signed, starts later
 * - live: in force today
 * - over: its term ran out (`ended`, or still `active` until the nightly job marks it)
 * - closed: rejected / cancelled
 */
export type AgreementPhase = "pending" | "upcoming" | "live" | "over" | "closed";

/** When the office's access ends after a termination request (request time + notice period). */
export function accessEndsAt(a: AgreementTerm): Date | null {
  if (!a.termination_requested_at) return null;
  return new Date(
    new Date(a.termination_requested_at).getTime() + a.notice_period_days * 86_400_000,
  );
}

export function agreementPhase(a: AgreementTerm, now: Date = new Date()): AgreementPhase {
  if (a.status === "sent" || a.status === "office_modified") return "pending";
  if (a.status === "ended") return "over";
  if (a.status !== "active") return "closed";
  const today = todayRiyadh(now);
  const ends = accessEndsAt(a);
  if ((a.end_date && today > a.end_date) || (ends && now.getTime() >= ends.getTime())) {
    return "over";
  }
  return today < a.start_date ? "upcoming" : "live";
}

/**
 * Units held by a signed agreement that hasn't run out (in force or yet to start): the database
 * refuses another request for them (private.agreement_conflict_unit).
 */
export function heldAgreementUnitIds(
  agreements: (AgreementTerm & { agreement_units: { unit_id: string }[] })[],
  now: Date = new Date(),
): Set<string> {
  const held = new Set<string>();
  for (const a of agreements) {
    const phase = agreementPhase(a, now);
    if (phase !== "live" && phase !== "upcoming") continue;
    for (const au of a.agreement_units) held.add(au.unit_id);
  }
  return held;
}
