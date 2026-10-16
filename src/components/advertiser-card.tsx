import { Link } from "@tanstack/react-router";
import { BadgeCheck, MessageCircle, Phone } from "lucide-react";

import { formatNumber, tf } from "@/components/listing-detail/format";
import { Button } from "@/components/ui/button";
import { langSearch, translate, type Locale } from "@/lib/i18n";
import { phoneHref, whatsappHref } from "@/lib/market";
import { cn } from "@/lib/utils";

export type AdvertiserView = {
  kind: "office" | "owner";
  id: string;
  name: string;
  /** Avatar (owner) or logo (office), already a full URL. */
  imageUrl: string | null;
  bannerUrl: string | null;
  /** Second line under the name (e.g. the office that publishes an owner's page). */
  subtitle?: string | null;
  licenseNo?: string | null;
  phone: string | null;
  whatsapp: string | null;
  listingsCount?: number | null;
  /** متوسط تقييم المستأجرين لصيانة هذا المكتب (لا يظهر إلا للمكاتب الموثّقة). */
  avgRating?: number | null;
  ratingsCount?: number | null;
};

/**
 * The advertiser box on a listing page: logo square (or round avatar for an owner), name with the
 * licence mark, WhatsApp + call, and a link to all of the advertiser's offers.
 */
export function AdvertiserCard({
  advertiser: a,
  inquiry,
  onContactClick,
  locale = "ar",
}: {
  advertiser: AdvertiserView;
  /** Pre-filled WhatsApp message. */
  inquiry?: string;
  /** Fired when the visitor taps the call or WhatsApp button (e.g. for listing analytics). */
  onContactClick?: (kind: "call" | "whatsapp") => void;
  locale?: Locale;
}) {
  const tel = phoneHref(a.phone);
  const wa = whatsappHref(a.whatsapp ?? a.phone, inquiry);
  // An office with a FAL licence on file is the only "verified" signal the public data carries.
  const licensed = a.kind === "office" && Boolean(a.licenseNo);
  const ratings = a.ratingsCount ?? 0;
  // The name is isolated (<bdi>) so an Arabic name inside the English sentence can't pull the
  // count across it («All listings by (12) …»).
  const [before, after] = translate(locale, "ld_adv_all_offers").split("{name}");
  const allOffers = (
    <>
      {before}
      <bdi>{a.name}</bdi>
      {after}
      {a.listingsCount != null ? ` (${formatNumber(a.listingsCount, locale)})` : ""}
    </>
  );
  const linkClass =
    "w-fit text-sm font-semibold text-foreground underline underline-offset-4 hover:text-red-text";

  return (
    <div className="flex flex-col gap-3.5 border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        {a.imageUrl ? (
          <img
            src={a.imageUrl}
            alt={a.name}
            loading="lazy"
            className={cn(
              "size-14 flex-none bg-muted object-cover",
              a.kind === "owner" && "rounded-full",
            )}
          />
        ) : (
          <span
            aria-hidden
            className={cn(
              "grid size-14 flex-none place-items-center bg-muted text-[13px] font-bold",
              a.kind === "owner" && "rounded-full",
            )}
          >
            {a.name.trim().slice(0, 2)}
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-[3px]">
          <p className="flex items-center gap-1.5 text-base font-bold">
            <span className="truncate">{a.name}</span>
            {licensed ? (
              <BadgeCheck
                className="size-[18px] flex-none text-primary"
                role="img"
                aria-label={tf(locale, "ld_adv_verified")}
              />
            ) : null}
          </p>
          {a.subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{a.subtitle}</p>
          ) : null}
          {a.licenseNo ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {tf(locale, "ld_adv_license")} <span dir="ltr">{a.licenseNo}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* 3 تقييمات على الأقل حتى ما تُبنى شارة على انطباع واحد عابر. */}
      {a.avgRating != null && ratings >= 3 ? (
        <span className="flex h-7 w-fit items-center bg-success-tint px-[9px] text-[13px] font-semibold text-success-tint-foreground tabular-nums">
          {tf(locale, "ld_adv_rating", {
            r: formatNumber(a.avgRating, locale, { maximumFractionDigits: 1 }),
            n: formatNumber(ratings, locale),
          })}
        </span>
      ) : licensed && ratings < 3 ? (
        <span className="flex h-7 w-fit items-center bg-muted px-[9px] text-[13px] font-semibold text-muted-foreground">
          {tf(locale, "ld_adv_rating_pending")}
        </span>
      ) : null}

      {wa || tel ? (
        <div className="grid grid-cols-2 gap-2">
          {wa ? (
            <Button
              variant="whatsapp"
              size="lg"
              asChild
              className={cn("justify-center px-3", !tel && "col-span-2")}
            >
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                onClick={() => onContactClick?.("whatsapp")}
              >
                <MessageCircle aria-hidden />
                {translate(locale, "card_whatsapp")}
              </a>
            </Button>
          ) : null}
          {tel ? (
            <Button
              variant="outline"
              size="lg"
              asChild
              className={cn("justify-center px-3", !wa && "col-span-2")}
            >
              <a href={tel} onClick={() => onContactClick?.("call")}>
                <Phone aria-hidden />
                {translate(locale, "card_call")}
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}

      {a.kind === "owner" ? (
        <Link
          to="/owner/$ownerId"
          params={{ ownerId: a.id }}
          search={langSearch(locale)}
          className={linkClass}
        >
          {allOffers}
        </Link>
      ) : a.id ? (
        <Link
          to="/office/$officeId"
          params={{ officeId: a.id }}
          search={langSearch(locale)}
          className={linkClass}
        >
          {allOffers}
        </Link>
      ) : null}
    </div>
  );
}
