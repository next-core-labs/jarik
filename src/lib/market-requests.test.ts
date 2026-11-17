import { describe, expect, it } from "vitest";

import { sortRequests, toPublicMarketRequest, type PublicMarketRequest } from "./market-requests";

const req = (over: Partial<PublicMarketRequest> = {}): PublicMarketRequest => ({
  id: "r1",
  createdAt: "2026-11-10T08:00:00Z",
  purpose: "rent",
  unitType: "شقة",
  city: "الرياض",
  district: "الملقا",
  budgetMin: null,
  budgetMax: 60000,
  notes: null,
  serious: false,
  contactsCount: 0,
  ...over,
});

describe("toPublicMarketRequest", () => {
  it("maps the serious flag and contacts count, defaulting to a plain request", () => {
    const base = {
      id: "r1",
      created_at: "2026-11-10T08:00:00Z",
      purpose: "rent",
      unit_type: "شقة",
      city: null,
      district: null,
      budget_min: null,
      budget_max: null,
      notes: null,
    };
    expect(toPublicMarketRequest(base)).toMatchObject({ serious: false, contactsCount: 0 });
    expect(toPublicMarketRequest({ ...base, serious: true, contacts_count: 2 })).toMatchObject({
      serious: true,
      contactsCount: 2,
    });
  });
});

describe("sortRequests", () => {
  it("pins serious requests first, newest first within each group", () => {
    const sorted = sortRequests([
      req({ id: "old", createdAt: "2026-11-01T08:00:00Z" }),
      req({ id: "serious-old", serious: true, createdAt: "2026-10-01T08:00:00Z" }),
      req({ id: "new", createdAt: "2026-11-15T08:00:00Z" }),
      req({ id: "serious-new", serious: true, createdAt: "2026-11-12T08:00:00Z" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["serious-new", "serious-old", "new", "old"]);
  });
});
