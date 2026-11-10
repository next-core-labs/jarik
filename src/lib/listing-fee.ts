/** An OWNER publishing a unit on the website: 50 SAR, VAT included, for 30 days. Offices publish free. */
export const LISTING_FEE_SAR = 50;
export const LISTING_FEE_HALALAS = LISTING_FEE_SAR * 100;
export const LISTING_PERIOD_DAYS = 30;

export const LISTING_FEE_LABEL = `${LISTING_FEE_SAR} ريال لكل ${LISTING_PERIOD_DAYS} يومًا`;

export type MarketState =
  | { kind: "paid"; until: Date }
  /** Listed before publishing was paid (none left since 2026-11-07: they got 30 paid days). */
  | { kind: "free" }
  | { kind: "expired"; until: Date }
  | { kind: "unlisted" };

/**
 * Where a unit stands on the website, from its stored market fields. Paid days belong to the office
 * that paid (market_org_id): pass the viewing office's id and another office's period counts as unlisted.
 */
export function marketState(
  unit: { market_listed: boolean; market_paid_until: string | null; market_org_id?: string | null },
  now: Date = new Date(),
  officeId?: string | null,
): MarketState {
  if (officeId && unit.market_org_id && unit.market_org_id !== officeId)
    return { kind: "unlisted" };
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

/**
 * Why the office can't publish units on the website yet (null when it can): the website only shows
 * offices that are listed («إظهار المكتب في دليل المكاتب», settings) AND verified by the platform.
 * Named the way the settings screen names it, so the office can find the switch.
 */
export function officeListingBlock(office: {
  listed_publicly: boolean | null;
  verified: boolean | null;
}): string | null {
  if (!office.listed_publicly)
    return "وحداتك المنشورة لا تظهر حتى تفعّل «إظهار المكتب في دليل المكاتب» من الإعدادات ← بيانات المكتب وتحفظ.";
  if (!office.verified)
    return "مكتبك بانتظار اعتماد إدارة جارك — تظهر وحداتك المنشورة في الموقع بعد الاعتماد.";
  return null;
}
