import { Link } from "@tanstack/react-router";

import { formatDistance, formatNumber, tf } from "@/components/listing-detail/format";
import { translate, type Locale } from "@/lib/i18n";
import { distanceMeters } from "@/lib/map-markers";
import { listingPrice, listingTitle, type Listing } from "@/lib/market";
import { mediaUrl } from "@/lib/unit-photos";

/** A compact offer under «عروض مشابهة قريبة»: arched photo, price, title, distance from this one. */
export function SimilarCard({
  listing: l,
  from,
  locale,
}: {
  listing: Listing;
  /** The listing on screen — its distance to this one is shown when both have a coordinate. */
  from: Pick<Listing, "lat" | "lng">;
  locale: Locale;
}) {
  const cover = l.coverPath ? mediaUrl(l.coverPath) : null;
  const title = listingTitle(l);
  const meters =
    from.lat != null && from.lng != null && l.lat != null && l.lng != null
      ? distanceMeters({ lat: from.lat, lng: from.lng }, { lat: l.lat, lng: l.lng })
      : null;

  return (
    <Link
      to="/unit/$unitId"
      params={{ unitId: l.id }}
      className="flex flex-col gap-2 bg-card p-2 shadow-[inset_0_0_0_1px_var(--color-border)] transition-shadow hover:shadow-[inset_0_0_0_2px_var(--color-foreground)] focus-visible:shadow-[inset_0_0_0_2px_var(--color-foreground)] focus-visible:outline-none"
    >
      <div className="h-[120px] overflow-hidden rounded-arch bg-muted">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
        ) : null}
      </div>
      <div className="flex flex-col gap-[3px] px-1 pb-1">
        <span className="text-[17px] font-bold tabular-nums">
          {formatNumber(listingPrice(l), locale)}{" "}
          <span className="text-xs font-medium text-muted-foreground">
            {translate(locale, l.purpose === "rent" ? "price_rent_unit" : "price_sale_unit")}
          </span>
        </span>
        <span className="line-clamp-2 text-sm font-semibold">{title}</span>
        {meters != null ? (
          <span className="text-xs font-semibold text-red-text tabular-nums">
            {tf(locale, "ld_away_from_here", { d: formatDistance(meters, locale) })}
          </span>
        ) : null}
      </div>
    </Link>
  );
}
