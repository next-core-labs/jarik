import { translate, type Locale } from "@/lib/i18n";
import { listingPrice, type Listing } from "@/lib/market";

/** [number, unit]: «55,000» «ر.س / سنوياً» for rent; «2.4» «مليون ر.س» for a sale of a million+. */
export function priceParts(l: Listing, locale: Locale): [string, string] {
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const n = listingPrice(l);
  if (l.purpose === "rent") return [n.toLocaleString("en-US"), t("price_rent_unit")];
  if (n >= 1e6) return [String(+(n / 1e6).toFixed(2)), t("price_million_unit")];
  return [n.toLocaleString("en-US"), t("price_sale_unit")];
}

/** 320 م under a kilometre (rounded to 10 m), else 1.2 كم. */
export function distanceText(km: number, locale: Locale): string {
  return km < 1
    ? `${Math.round((km * 1000) / 10) * 10} ${translate(locale, "unit_m")}`
    : `${km.toFixed(1)} ${translate(locale, "unit_km")}`;
}
