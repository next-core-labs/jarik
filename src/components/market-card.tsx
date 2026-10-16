import { Link } from "@tanstack/react-router";
import { Bath, BedDouble, Heart, LocateFixed, MessageCircle, Phone, Ruler } from "lucide-react";

import { JarakSymbol } from "@/components/jarak-logo";
import { inquiryText } from "@/components/listing-row";
import { langSearch, translate, type Locale } from "@/lib/i18n";
import { distanceText, priceParts } from "@/lib/market-format";
import { listingTitle, phoneHref, priceDropPct, whatsappHref, type Listing } from "@/lib/market";
import { PURPOSE_LABEL } from "@/lib/property-types";
import { brandingUrl, mediaUrl } from "@/lib/unit-photos";
import { cn } from "@/lib/utils";

const PURPOSE_LABEL_EN = { rent: "For rent", sale: "For sale" } as const;

/** Two letters standing in for an office without a logo. */
function initials(name: string): string {
  const words = name
    .replace(/^(مكتب|شركة|مؤسسة)\s+/, "")
    .trim()
    .split(/\s+/);
  return (words[0] ?? "").slice(0, 6);
}

/**
 * One offer in the marketplace list beside the map: arched photo, price, distance, title, specs
 * and the two contact buttons. Hovering it lights its pin red on the map (and vice versa); the
 * whole card opens the listing through a stretched title link, so the buttons stay real links.
 */
export function MarketCard({
  listing: l,
  distanceKm,
  hot = false,
  locale,
  onHover,
  saved,
  onToggleSave,
}: {
  listing: Listing;
  distanceKm?: number | null;
  hot?: boolean;
  locale: Locale;
  onHover?: (id: string | null) => void;
  /** Favourite state; the heart is shown only when a toggle is passed. */
  saved?: boolean;
  onToggleSave?: (id: string) => void;
}) {
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  const cover = l.coverPath ? mediaUrl(l.coverPath) : null;
  const logo = !l.owner && l.office.logoPath ? brandingUrl(l.office.logoPath) : null;
  const advertiser = l.owner?.name || l.office.name;
  const tel = phoneHref(l.contactPhone);
  const wa = whatsappHref(l.contactWhatsapp, inquiryText(l));
  const [price, unit] = priceParts(l, locale);
  const rent = l.purpose === "rent";
  const drop = priceDropPct(l);

  return (
    <article
      id={`card-${l.id}`}
      onMouseEnter={() => onHover?.(l.id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        "relative flex shrink-0 gap-3 bg-card p-2.5 transition-shadow",
        hot
          ? "shadow-[inset_0_0_0_2px_var(--color-foreground)]"
          : "shadow-[inset_0_0_0_1px_var(--color-border)]",
      )}
    >
      <div className="relative grid h-[132px] w-[124px] shrink-0 place-items-center overflow-hidden rounded-arch bg-muted">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
            <JarakSymbol mono className="size-[30px] opacity-25" />
            {t("card_no_photos")}
          </span>
        )}
        <span
          className={cn(
            "absolute start-1.5 bottom-1.5 flex h-[22px] items-center px-[7px] text-xs font-semibold",
            rent
              ? "bg-foreground text-background"
              : "bg-card text-foreground shadow-[inset_0_0_0_1.5px_var(--color-foreground)]",
          )}
        >
          {locale === "en" ? PURPOSE_LABEL_EN[l.purpose] : PURPOSE_LABEL[l.purpose]}
        </span>
        <span
          className="absolute end-1.5 bottom-1.5 grid size-[30px] place-items-center overflow-hidden bg-card text-[9px] font-bold shadow-[inset_0_0_0_1px_var(--color-border)]"
          title={advertiser}
        >
          {logo ? (
            <img src={logo} alt="" className="size-full object-contain" />
          ) : (
            initials(advertiser)
          )}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-[5px] pt-0.5">
        <div className="flex items-start justify-between gap-1.5">
          <p className="text-[19px] leading-tight font-bold whitespace-nowrap tabular-nums">
            {price} <span className="text-xs font-medium text-muted-foreground">{unit}</span>
          </p>
          {onToggleSave ? (
            <button
              type="button"
              onClick={() => onToggleSave(l.id)}
              aria-pressed={Boolean(saved)}
              aria-label={saved ? t("fav_remove") : t("fav_add")}
              title={saved ? t("fav_remove") : t("fav_add")}
              className="relative z-10 -m-1.5 grid size-8 shrink-0 place-items-center text-foreground transition-colors hover:text-red-text"
            >
              <Heart
                className={cn("size-[18px]", saved && "fill-primary text-primary")}
                aria-hidden
              />
            </button>
          ) : null}
        </div>
        {distanceKm != null || drop ? (
          <div className="flex flex-wrap items-center gap-2">
            {distanceKm != null ? (
              <span className="flex items-center gap-1 text-[13px] font-semibold whitespace-nowrap text-red-text">
                <LocateFixed className="size-[13px] text-primary" aria-hidden />
                {distanceText(distanceKm, locale)}
              </span>
            ) : null}
            {drop ? (
              <span className="px-1.5 py-px text-xs font-semibold whitespace-nowrap tabular-nums shadow-[inset_0_0_0_1px_var(--color-border)]">
                ▼ {t("price_drop").replace("{p}", String(drop))}
              </span>
            ) : null}
          </div>
        ) : null}
        <Link
          to="/unit/$unitId"
          params={{ unitId: l.id }}
          search={langSearch(locale)}
          className="truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:shadow-[inset_0_0_0_2px_var(--color-ring)]"
        >
          {listingTitle(l)}
        </Link>
        <div className="flex flex-wrap gap-x-[11px] gap-y-0.5 text-[13px] font-medium text-muted-foreground">
          {l.rooms ? (
            <span className="flex items-center gap-1">
              <BedDouble className="size-3.5" aria-hidden />
              {l.rooms}
            </span>
          ) : null}
          {l.bathrooms ? (
            <span className="flex items-center gap-1">
              <Bath className="size-3.5" aria-hidden />
              {l.bathrooms}
            </span>
          ) : null}
          {l.area ? (
            <span className="flex items-center gap-1 tabular-nums">
              <Ruler className="size-3.5" aria-hidden />
              {l.area} {t("unit_sqm")}
            </span>
          ) : null}
          {l.furnished ? <span>{t("filter_furnished_yes")}</span> : null}
        </div>
        {wa || tel ? (
          <div className="relative z-10 mt-auto flex gap-1.5">
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 flex-1 items-center justify-center gap-1.5 bg-whatsapp text-[13px] font-semibold text-whatsapp-foreground transition-colors hover:bg-whatsapp/90"
              >
                <MessageCircle className="size-[15px]" aria-hidden />
                {t("card_whatsapp")}
              </a>
            ) : null}
            {tel ? (
              <a
                href={tel}
                className="flex h-9 flex-1 items-center justify-center gap-1.5 border-[1.5px] border-foreground bg-card text-[13px] font-semibold transition-colors hover:bg-muted"
              >
                <Phone className="size-[15px]" aria-hidden />
                {t("card_call")}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** Loading placeholder in the same shape as the card. */
export function MarketCardSkeleton() {
  return (
    <div className="flex shrink-0 gap-3 bg-card p-2.5 shadow-[inset_0_0_0_1px_var(--color-border)]">
      <div className="h-[132px] w-[124px] shrink-0 animate-pulse rounded-arch bg-muted" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <div className="h-5 w-28 animate-pulse bg-muted" />
        <div className="h-4 w-3/4 animate-pulse bg-background" />
        <div className="h-4 w-1/2 animate-pulse bg-background" />
      </div>
    </div>
  );
}
