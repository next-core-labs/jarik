/** Publishing a unit on the website: 50 SAR, VAT included, for 30 days. */
export const LISTING_FEE_SAR = 50;
export const LISTING_FEE_HALALAS = LISTING_FEE_SAR * 100;
export const LISTING_PERIOD_DAYS = 30;

export const LISTING_FEE_LABEL = `${LISTING_FEE_SAR} ريال لكل ${LISTING_PERIOD_DAYS} يومًا`;

export type MarketState =
  | { kind: "paid"; until: Date }
  /** Listed before publishing was paid; free while it stays listed. */
  | { kind: "free" }
  | { kind: "expired"; until: Date }
  | { kind: "unlisted" };

/** Where a unit stands on the website, from its stored market fields. */
export function marketState(
  unit: { market_listed: boolean; market_paid_until: string | null },
  now: Date = new Date(),
): MarketState {
  const until = unit.market_paid_until ? new Date(unit.market_paid_until) : null;
  if (until && until > now) return { kind: "paid", until };
  if (unit.market_listed && !until) return { kind: "free" };
  if (until) return { kind: "expired", until };
  return { kind: "unlisted" };
}

/** True when switching the unit on in the market needs no payment first. */
export function canListWithoutPaying(state: MarketState): boolean {
  return state.kind === "paid" || state.kind === "free";
}

/** The success_url carries our row id; Moyasar may append its own query with a second "?". */
export function listingPaymentIdFromSearch(search: string): string | null {
  const match =
    /listing_payment=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(search);
  return match?.[1]?.toLowerCase() ?? null;
}
