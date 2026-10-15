import { Link } from "@tanstack/react-router";
import {
  BedDouble,
  Bath,
  ImageOff,
  MapPin,
  MessageCircle,
  Phone,
  Ruler,
  Camera,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sar } from "@/lib/format";
import {
  listingLocation,
  listingPrice,
  listingTitle,
  phoneHref,
  whatsappHref,
  type Listing,
} from "@/lib/market";
import { PRICE_SUFFIX, PURPOSE_LABEL } from "@/lib/property-types";
import { brandingUrl, mediaUrl } from "@/lib/unit-photos";

/** The message a visitor sends to the advertiser from a listing (includes the link to it). */
export function inquiryText(l: Listing): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `مرحبًا، أستفسر عن: ${listingTitle(l)}${origin ? ` — ${origin}/unit/${l.id}` : ""}`;
}

/** Small round picture with a fallback to the first letters of the name. */
export function Avatar({
  src,
  name,
  className = "size-9",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  return src ? (
    <img src={src} alt={name} loading="lazy" className={`${className} object-cover`} />
  ) : (
    <span
      aria-hidden
      className={`${className} grid place-items-center bg-accent text-xs font-bold text-accent-foreground`}
    >
      {name.trim().slice(0, 2)}
    </span>
  );
}

/** One offer in a results list: photo, price, specs, title, location and contact buttons. */
export function ListingRow({
  listing: l,
  showAdvertiser = true,
}: {
  listing: Listing;
  showAdvertiser?: boolean;
}) {
  const cover = l.coverPath ? mediaUrl(l.coverPath) : null;
  const advertiserName = l.owner?.name || l.office.name;
  const advertiserImage = l.owner?.avatarPath
    ? mediaUrl(l.owner.avatarPath)
    : !l.owner && l.office.logoPath
      ? brandingUrl(l.office.logoPath)
      : null;
  const tel = phoneHref(l.contactPhone);
  const wa = whatsappHref(l.contactWhatsapp, inquiryText(l));
  const title = listingTitle(l);
  const location = listingLocation(l);

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-deed transition-shadow hover:shadow-e1">
      {/* Full-width photo on top, on every screen size — the offer's picture is the first thing
          a visitor sees, aqar.fm-style, rather than sharing the card with the details beside it.
          The arch is the brand's "your home" shape, so its curve clips the top corners — every
          overlay sits along the bottom edge. */}
      <Link
        to="/unit/$unitId"
        params={{ unitId: l.id }}
        className="relative mx-2.5 mt-2.5 block aspect-[16/10] overflow-hidden rounded-arch bg-muted sm:aspect-[16/9]"
        aria-label={title}
      >
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="size-full object-cover grayscale contrast-[1.08]"
          />
        ) : (
          <span className="grid size-full place-content-center justify-items-center gap-1 px-3 text-center text-muted-foreground">
            <ImageOff className="size-9 opacity-50" aria-hidden />
            <span className="text-xs">لا توجد صور لهذا العرض</span>
          </span>
        )}
        <span className="absolute start-2.5 bottom-2.5 flex flex-wrap gap-1">
          {/* Red is reserved for price, the primary action and the "available" mark — the rent/sale
              purpose label is neither, so both read in ink/plaster, distinguished by text only. */}
          <Badge className="bg-brass text-brass-foreground hover:bg-brass">
            {PURPOSE_LABEL[l.purpose]}
          </Badge>
          {l.furnished ? (
            <Badge className="bg-card/90 text-card-foreground hover:bg-card/90">مؤثثة</Badge>
          ) : null}
        </span>
        {/* The advertiser's mark rides on the photo, so it is visible without reading the card. */}
        {advertiserImage ? (
          <img
            src={advertiserImage}
            alt={advertiserName}
            loading="lazy"
            className="absolute end-2.5 bottom-2.5 size-10 border-2 border-card bg-card object-cover"
          />
        ) : null}
        {l.photosCount > 1 ? (
          <span
            className={`absolute bottom-2.5 inline-flex items-center gap-1 bg-black/60 px-2 py-0.5 text-xs text-white ${advertiserImage ? "end-14" : "end-2.5"}`}
          >
            <Camera className="size-3.5" aria-hidden />
            {l.photosCount}
          </span>
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl font-bold">
            {sar(listingPrice(l))}
            {PRICE_SUFFIX[l.purpose] ? (
              <span className="ms-1 text-sm font-normal text-muted-foreground">
                {PRICE_SUFFIX[l.purpose]}
              </span>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {l.rooms != null ? (
              <span className="inline-flex items-center gap-1">
                <BedDouble className="size-4" aria-hidden />
                {l.rooms}
                <span className="sr-only">غرف</span>
              </span>
            ) : null}
            {l.bathrooms > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Bath className="size-4" aria-hidden />
                {l.bathrooms}
                <span className="sr-only">حمامات</span>
              </span>
            ) : null}
            {l.area ? (
              <span className="inline-flex items-center gap-1">
                <Ruler className="size-4" aria-hidden />
                {l.area} م²
              </span>
            ) : null}
          </div>
        </div>

        <h3 className="text-base font-bold leading-snug">
          <Link
            to="/unit/$unitId"
            params={{ unitId: l.id }}
            className="text-foreground underline underline-offset-4 hover:text-red-text"
          >
            {title}
          </Link>
        </h3>

        {location ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4 shrink-0 text-brass" aria-hidden />
            {location}
          </p>
        ) : null}

        {l.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{l.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
          {showAdvertiser ? <Advertiser l={l} /> : <span />}
          <div className="flex gap-2">
            {tel ? (
              <Button size="sm" variant="outline" asChild>
                <a href={tel}>
                  <Phone className="size-4" aria-hidden />
                  اتصال
                </a>
              </Button>
            ) : null}
            {wa ? (
              <Button size="sm" variant="whatsapp" asChild>
                <a href={wa} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" aria-hidden />
                  واتساب
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Who is advertising: the owner's page when the office published one, otherwise the office. */
function Advertiser({ l }: { l: Listing }) {
  const owner = l.owner;
  const name = owner?.name || l.office.name;
  const image = owner?.avatarPath
    ? mediaUrl(owner.avatarPath)
    : !owner && l.office.logoPath
      ? brandingUrl(l.office.logoPath)
      : null;
  const content = (
    <span className="flex items-center gap-2 text-sm">
      <Avatar src={image} name={name} />
      <span className="min-w-0">
        <span className="block max-w-48 truncate font-medium">{name}</span>
        {owner ? (
          <span className="block max-w-48 truncate text-xs text-muted-foreground">
            عبر {l.office.name}
          </span>
        ) : null}
      </span>
    </span>
  );
  if (owner) {
    return (
      <Link to="/owner/$ownerId" params={{ ownerId: owner.id }} className="hover:underline">
        {content}
      </Link>
    );
  }
  if (l.office.id) {
    return (
      <Link to="/office/$officeId" params={{ officeId: l.office.id }} className="hover:underline">
        {content}
      </Link>
    );
  }
  return content;
}

export function ListingRowSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="mx-2.5 mt-2.5 aspect-[16/10] animate-pulse rounded-arch bg-muted sm:aspect-[16/9]" />
      <div className="space-y-3 p-4">
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
