import { describe, expect, it } from "vitest";

import { agreementPhase, heldAgreementUnitIds, type AgreementTerm } from "./agreement-live";

const base: AgreementTerm = {
  status: "active",
  start_date: "2026-11-01",
  end_date: "2027-10-31",
  termination_requested_at: null,
  notice_period_days: 30,
};
// 2026-11-07 10:00 in Riyadh.
const now = new Date("2026-11-07T07:00:00Z");

describe("agreementPhase", () => {
  it("is live between the start and end dates", () => {
    expect(agreementPhase(base, now)).toBe("live");
    expect(agreementPhase({ ...base, end_date: null }, now)).toBe("live");
  });

  it("uses the Riyadh date: the end date still counts until midnight in Riyadh", () => {
    const lastDay = { ...base, end_date: "2026-11-07" };
    expect(agreementPhase(lastDay, new Date("2026-11-07T20:59:00Z"))).toBe("live");
    expect(agreementPhase(lastDay, new Date("2026-11-07T21:00:00Z"))).toBe("over");
  });

  it("is upcoming before its start date", () => {
    expect(agreementPhase({ ...base, start_date: "2026-12-01" }, now)).toBe("upcoming");
  });

  it("is over once the notice period after a termination request is served", () => {
    const terminated = { ...base, termination_requested_at: "2026-10-01T07:00:00Z" };
    expect(agreementPhase(terminated, now)).toBe("over");
    expect(agreementPhase({ ...terminated, notice_period_days: 60 }, now)).toBe("live");
  });

  it("maps the other statuses", () => {
    expect(agreementPhase({ ...base, status: "sent" }, now)).toBe("pending");
    expect(agreementPhase({ ...base, status: "office_modified" }, now)).toBe("pending");
    expect(agreementPhase({ ...base, status: "ended" }, now)).toBe("over");
    expect(agreementPhase({ ...base, status: "cancelled" }, now)).toBe("closed");
    expect(agreementPhase({ ...base, status: "rejected" }, now)).toBe("closed");
  });
});

describe("heldAgreementUnitIds", () => {
  it("holds units of live and upcoming agreements only", () => {
    const held = heldAgreementUnitIds(
      [
        { ...base, agreement_units: [{ unit_id: "live" }] },
        { ...base, start_date: "2027-01-01", agreement_units: [{ unit_id: "upcoming" }] },
        { ...base, end_date: "2026-11-06", agreement_units: [{ unit_id: "over" }] },
        { ...base, status: "sent", agreement_units: [{ unit_id: "pending" }] },
      ],
      now,
    );
    expect([...held].sort()).toEqual(["live", "upcoming"]);
  });
});
