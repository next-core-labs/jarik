import { describe, expect, it } from "vitest";

import { canListWithoutPaying, listingPaymentIdFromSearch, marketState } from "./listing-fee";
import { isMoyasarCheckoutUrl } from "./moyasar-url";

const now = new Date("2026-11-01T12:00:00Z");
const future = "2026-11-20T12:00:00Z";
const past = "2026-10-20T12:00:00Z";

describe("marketState", () => {
  it("is paid while the paid period runs, listed or hidden", () => {
    expect(marketState({ market_listed: true, market_paid_until: future }, now).kind).toBe("paid");
    expect(marketState({ market_listed: false, market_paid_until: future }, now).kind).toBe("paid");
  });

  it("keeps a unit listed before paid publishing free only while it stays listed", () => {
    expect(marketState({ market_listed: true, market_paid_until: null }, now).kind).toBe("free");
    expect(marketState({ market_listed: false, market_paid_until: null }, now).kind).toBe(
      "unlisted",
    );
  });

  it("is expired once the paid period is over, even before the expiry job unlists it", () => {
    expect(marketState({ market_listed: false, market_paid_until: past }, now).kind).toBe(
      "expired",
    );
    expect(marketState({ market_listed: true, market_paid_until: past }, now).kind).toBe("expired");
  });

  it("asks for payment only outside a paid period or free listing", () => {
    expect(canListWithoutPaying({ kind: "paid", until: new Date(future) })).toBe(true);
    expect(canListWithoutPaying({ kind: "free" })).toBe(true);
    expect(canListWithoutPaying({ kind: "expired", until: new Date(past) })).toBe(false);
    expect(canListWithoutPaying({ kind: "unlisted" })).toBe(false);
  });
});

describe("listingPaymentIdFromSearch", () => {
  const id = "0f8b6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

  it("reads our row id, also when Moyasar appends its own query with a second '?'", () => {
    expect(listingPaymentIdFromSearch(`?listing_payment=${id}`)).toBe(id);
    expect(listingPaymentIdFromSearch(`?listing_payment=${id}&id=pay_1&status=paid`)).toBe(id);
    expect(listingPaymentIdFromSearch(`?listing_payment=${id}?id=pay_1&status=paid`)).toBe(id);
  });

  it("ignores anything that is not a uuid", () => {
    expect(listingPaymentIdFromSearch("?listing_payment=abc")).toBeNull();
    expect(listingPaymentIdFromSearch("?status=paid")).toBeNull();
  });
});

describe("isMoyasarCheckoutUrl", () => {
  it("accepts only https Moyasar pages", () => {
    expect(isMoyasarCheckoutUrl("https://checkout.moyasar.com/invoices/abc")).toBe(true);
    expect(isMoyasarCheckoutUrl("https://moyasar.com/x")).toBe(true);
    expect(isMoyasarCheckoutUrl("http://checkout.moyasar.com/invoices/abc")).toBe(false);
    expect(isMoyasarCheckoutUrl("https://moyasar.com.evil.example/x")).toBe(false);
    expect(isMoyasarCheckoutUrl("not a url")).toBe(false);
  });
});
