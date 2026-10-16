import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Heart, MessageCircle, Phone, Share2 } from "lucide-react";
import { toast } from "sonner";

import { AdvertiserCard, type AdvertiserView } from "@/components/advertiser-card";
import { formatNumber } from "@/components/listing-detail/format";
import { SimilarCard } from "@/components/listing-detail/similar-card";
import { inquiryText } from "@/components/listing-row";
import { MortgageCalculator } from "@/components/mortgage-calculator";
import { NearbyPlacesSection } from "@/components/nearby-places-section";
import { PhotoGallery } from "@/components/photo-gallery";
import { SiteHeader } from "@/components/site-header";
import { UnitRequestForm } from "@/components/unit-request-form";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useFavorites } from "@/lib/favorites";
import { isNativeApp, nativeShare } from "@/lib/native";
import { langSearch, localeFromSearch, translate, useLocale } from "@/lib/i18n";
import { trackListingEvent } from "@/lib/office-tools.functions";
import { publicDate, publicNum, publicSar } from "@/lib/format";
import {
  listingLocation,
  listingPrice,
  listingTitle,
  phoneHref,
  priceDropPct,
  similarListings,
  toListing,
  whatsappHref,
  type Listing,
  type ListingRow as ListingRowLike,
} from "@/lib/market";
import { PRICE_SUFFIX } from "@/lib/property-types";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { brandingUrl, mediaUrl } from "@/lib/unit-photos";
import { cn } from "@/lib/utils";

type UnitPageData =
  | {
      status: "ok";
      listing: Listing;
      photos: string[];
      similar: Listing[];
      advertiser: AdvertiserView;
    }
  | { status: "missing" }
  | { status: "error" };

/** Everything the page needs, fetched on the server too so link previews (WhatsApp) have the photo. */
/** Public ids are uuids — anything else can't be a record (and PostgREST would fail with 22P02). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadUnitPage(unitId: string): Promise<UnitPageData> {
  if (!UUID_RE.test(unitId)) return { status: "missing" };
  try {
    const { data: row, error } = await supabase
      .from("vacant_units_public")
      .select("*")
      .eq("id", unitId)
      .maybeSingle();
    if (error) return { status: "error" };
    const listing = row ? toListing(row) : null;
    if (!listing) return { status: "missing" };

    const [photosRes, byTypeRes, byDistrictRes, ownerRes, officeRes] = await Promise.all([
      supabase
        .from("vacant_unit_photos_public")
        .select("path, position")
        .eq("unit_id", unitId)
        .order("position"),
      supabase
        .from("vacant_units_public")
        .select("*")
        .eq("unit_type", listing.unitType)
        .neq("id", unitId)
        .limit(20),
      listing.district
        ? supabase
            .from("vacant_units_public")
            .select("*")
            .eq("district", listing.district)
            .neq("id", unitId)
            .limit(20)
        : Promise.resolve({ data: [] as ListingRowLike[] }),
      listing.owner
        ? supabase
            .from("owner_pages_public")
            .select("*")
            .eq("owner_id", listing.owner.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      listing.office.id
        ? supabase.from("office_pages_public").select("*").eq("id", listing.office.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const photos = (photosRes.data ?? []).map((p) => p.path).filter((p): p is string => Boolean(p));
    const candidates = new Map<string, Listing>();
    for (const row of [...(byDistrictRes.data ?? []), ...(byTypeRes.data ?? [])]) {
      const l = toListing(row);
      if (l) candidates.set(l.id, l);
    }
    const similar = similarListings([...candidates.values()], listing, 3);

    const owner = ownerRes.data;
    const office = officeRes.data;
    const advertiser: AdvertiserView = owner?.owner_id
      ? {
          kind: "owner",
          id: owner.owner_id,
          name: owner.display_name ?? listing.owner?.name ?? "",
          imageUrl: owner.avatar_path ? mediaUrl(owner.avatar_path) : null,
          bannerUrl: office?.banner_path ? mediaUrl(office.banner_path) : null,
          subtitle: `عبر ${listing.office.name}`,
          phone: listing.contactPhone,
          whatsapp: listing.contactWhatsapp,
          listingsCount: owner.listings_count,
        }
      : {
          kind: "office",
          id: listing.office.id ?? "",
          name: listing.office.name,
          imageUrl: listing.office.logoPath ? brandingUrl(listing.office.logoPath) : null,
          bannerUrl: office?.banner_path ? mediaUrl(office.banner_path) : null,
          subtitle: [listing.office.city, listing.office.district].filter(Boolean).join(" · "),
          licenseNo: listing.office.licenseNo,
          phone: listing.contactPhone,
          whatsapp: listing.contactWhatsapp,
          listingsCount: office?.listings_count ?? null,
          avgRating: office?.avg_rating ?? null,
          ratingsCount: office?.ratings_count ?? null,
        };

    return { status: "ok", listing, photos, similar, advertiser };
  } catch {
    return { status: "error" };
  }
}

export const Route = createFileRoute("/unit/$unitId")({
  staticData: { sitemap: false, publicLocale: true },
  loader: ({ params }) => loadUnitPage(params.unitId),
  head: ({ loaderData, params, match }) => {
    const en = localeFromSearch(match.search) === "en";
    if (loaderData?.status !== "ok") {
      const title = en ? "Property listing — Jarak" : "عرض عقاري — جارك";
      const description = en
        ? "Browse the property listings on Jarak."
        : "تصفح العروض العقارية المتاحة على جارك.";
      return {
        meta: [
          { title },
          { name: "description", content: description },
          { name: "robots", content: "noindex" },
          { property: "og:title", content: title },
          { property: "og:description", content: description },
          { property: "og:type", content: "website" },
          { name: "twitter:card", content: "summary" },
        ],
      };
    }
    const { listing: l, photos } = loaderData;
    const title = `${listingTitle(l)} — ${en ? "Jarak" : "جارك"}`;
    const facts = [
      `${publicSar(listingPrice(l), en ? "en" : "ar")}${
        PRICE_SUFFIX[l.purpose] ? (en ? " / year" : " سنويًا") : ""
      }`,
      l.rooms != null ? `${publicNum(l.rooms)} ${en ? "rooms" : "غرف"}` : null,
      l.area ? `${publicNum(l.area)} ${en ? "m²" : "م²"}` : null,
      listingLocation(l) || null,
    ].filter(Boolean);
    const description = `${facts.join(" · ")}. ${l.office.name}.`;
    // The address the page itself shows (listingLocation): street and district, and the city.
    const streetAddress = [l.street, l.district ? `حي ${l.district}` : null]
      .filter(Boolean)
      .join("، ");
    const image = photos[0] ?? l.coverPath;
    const url = `https://jarak-ksa.com/unit/${encodeURIComponent(params.unitId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(image ? [{ property: "og:image", content: mediaUrl(image) }] : []),
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        ...(image ? [{ name: "twitter:image", content: mediaUrl(image) }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "Accommodation",
              name: listingTitle(l),
              url,
              description: l.description || description,
              accommodationCategory: l.unitType,
              ...(l.rooms != null ? { numberOfBedrooms: l.rooms } : {}),
              ...(l.bathrooms > 0 ? { numberOfBathroomsTotal: l.bathrooms } : {}),
              ...(l.area
                ? { floorSize: { "@type": "QuantitativeValue", value: l.area, unitCode: "MTK" } }
                : {}),
              ...(image ? { image: mediaUrl(image) } : {}),
              ...(streetAddress || l.office.city
                ? {
                    address: {
                      "@type": "PostalAddress",
                      ...(streetAddress ? { streetAddress } : {}),
                      ...(l.office.city ? { addressLocality: l.office.city } : {}),
                      addressCountry: "SA",
                    },
                  }
                : {}),
              offers: {
                "@type": "Offer",
                price: listingPrice(l),
                priceCurrency: "SAR",
                availability: "https://schema.org/InStock",
                url,
                ...(l.purpose === "rent"
                  ? {
                      priceSpecification: {
                        "@type": "UnitPriceSpecification",
                        price: listingPrice(l),
                        priceCurrency: "SAR",
                        unitText: "YEAR",
                      },
                    }
                  : {}),
              },
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "سوق العروض",
                  item: "https://jarak-ksa.com/",
                },
                { "@type": "ListItem", position: 2, name: listingTitle(l), item: url },
              ],
            },
          ]),
        },
      ],
    };
  },
  component: UnitPublic,
});

function UnitPublic() {
  useTrackSiteVisit("/unit/$unitId");
  const data = Route.useLoaderData();
  const router = useRouter();
  const [locale] = useLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  const unitId = data.status === "ok" ? data.listing.id : null;
  const track = useServerFn(trackListingEvent);
  const fav = useFavorites();
  // مرة وحدة لكل زيارة فعلية بالمتصفح — عمدًا بدون تسجيل بالخادم (loader) حتى ما تُحتسب زيارات
  // بوتات معاينة الروابط (واتساب وغيره) كمشاهدات حقيقية.
  const trackedView = useRef(false);
  useEffect(() => {
    if (!unitId || trackedView.current) return;
    trackedView.current = true;
    track({ data: { unitId, eventType: "view" } }).catch(() => {});
  }, [unitId, track]);

  if (data.status !== "ok") {
    return (
      <div
        dir={locale === "en" ? "ltr" : "rtl"}
        lang={locale}
        className="min-h-screen bg-background"
      >
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-bold">
            {data.status === "error"
              ? locale === "en"
                ? "Couldn't load this listing"
                : "تعذّر تحميل العرض"
              : locale === "en"
                ? "This listing is unavailable"
                : "العرض غير متاح حاليًا"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {data.status === "error"
              ? locale === "en"
                ? "Check your connection and try again."
                : "تحقّق من الاتصال ثم أعد المحاولة."
              : locale === "en"
                ? "It may have been rented, or the office no longer lists it publicly."
                : "ربما تم تأجيره أو أن المكتب لا يعرض وحداته علنًا."}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            {data.status === "error" ? (
              <Button variant="outline" onClick={() => router.invalidate()}>
                {t("results_retry")}
              </Button>
            ) : null}
            <Button asChild>
              <Link to="/" search={langSearch(locale)}>
                {locale === "en" ? "Back to the market" : "العودة إلى سوق العروض"}
              </Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const { listing: l, photos, similar, advertiser } = data;
  const title = listingTitle(l);
  const location = listingLocation(l);

  const share = async () => {
    const url = window.location.href;
    try {
      if (isNativeApp()) {
        await nativeShare(title, url);
        return;
      }
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(locale === "en" ? "Listing link copied" : "تم نسخ رابط العرض");
    } catch {
      // the user closed the share sheet, or the clipboard is blocked
    }
  };

  const onContactClick = (kind: "call" | "whatsapp") =>
    track({
      data: { unitId: l.id, eventType: kind === "call" ? "call_click" : "whatsapp_click" },
    }).catch(() => {});
  const inquiry = inquiryText(l);
  const tel = phoneHref(advertiser.phone);
  const wa = whatsappHref(advertiser.whatsapp ?? advertiser.phone, inquiry);

  const priceMain = formatNumber(listingPrice(l), locale);
  const drop = priceDropPct(l);
  const saved = fav.has(l.id);
  const priceUnit = t(l.purpose === "rent" ? "price_rent_unit" : "price_sale_unit");
  const num = (n: number) => formatNumber(n, locale);

  const districtLine = [location, l.unitNumber ? `${t("info_unit_no")} ${l.unitNumber}` : null]
    .filter(Boolean)
    .join(" · ");
  const specs: [string, string][] = [
    [t("info_type"), l.unitType || "—"],
    [t("info_area"), l.area ? `${num(l.area)} ${t("unit_sqm")}` : "—"],
    [t("info_rooms"), l.rooms != null ? num(l.rooms) : "—"],
    [t("info_bathrooms"), l.bathrooms > 0 ? num(l.bathrooms) : "—"],
  ];
  // The facts the four-cell strip has no room for.
  const moreFacts = [
    l.floorNo ? `${t("info_floor")}: ${l.floorNo}` : null,
    l.halls > 0 ? `${t("info_halls")}: ${num(l.halls)}` : null,
    l.createdAt ? `${t("info_added")}: ${publicDate(l.createdAt, locale)}` : null,
  ].filter(Boolean);
  const features = [
    ...l.amenities,
    l.furnished ? t("filter_furnished_yes") : t("filter_furnished_no"),
  ];

  const purposeBadge = (
    <span
      className={cn(
        "flex h-[30px] items-center px-2.5 text-sm font-semibold",
        l.purpose === "rent"
          ? "bg-foreground text-background"
          : "bg-background text-foreground shadow-[inset_0_0_0_1.5px_var(--color-foreground)]",
      )}
    >
      {t(l.purpose === "rent" ? "tab_rent" : "tab_sale")}
    </span>
  );

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-4 pt-5 pb-28 sm:px-5 lg:pb-16">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/"
            search={langSearch(locale)}
            className="flex items-center gap-1.5 text-[15px] font-semibold underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-[18px] rtl:rotate-180" aria-hidden />
            {t("ld_back_map")}
          </Link>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={share}
              className="flex h-10 cursor-pointer items-center gap-1.5 border border-border bg-card px-3 text-sm font-semibold transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Share2 className="size-4" aria-hidden />
              {t("unit_share")}
            </button>
            <button
              type="button"
              onClick={() => fav.toggle(l.id)}
              aria-pressed={saved}
              aria-label={saved ? t("fav_remove") : t("fav_add")}
              title={saved ? t("fav_remove") : t("fav_add")}
              className="grid size-10 cursor-pointer place-items-center border border-border bg-card transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <Heart
                className={cn("size-[18px]", saved && "fill-primary text-primary")}
                aria-hidden
              />
            </button>
          </div>
        </div>

        <PhotoGallery paths={photos} alt={title} locale={locale} badge={purposeBadge} />

        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-7">
            <section className="flex flex-col gap-2.5">
              {districtLine ? (
                <p className="text-sm text-muted-foreground">{districtLine}</p>
              ) : null}
              <h1 className="text-[28px] leading-[1.35] font-bold text-pretty sm:text-[32px]">
                {title}
              </h1>
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-[34px] leading-tight font-bold tabular-nums">
                  {priceMain}
                </span>
                <span className="text-base font-medium text-muted-foreground">{priceUnit}</span>
                {drop ? (
                  <span className="bg-card px-2 py-[3px] text-[13px] font-semibold tabular-nums shadow-[inset_0_0_0_1px_var(--color-border)]">
                    ▼ {t("price_drop").replace("{p}", String(drop))} · {t("price_drop_auto")}
                  </span>
                ) : null}
              </p>
            </section>

            <div className="flex flex-col gap-2">
              <dl className="grid grid-cols-2 gap-px border border-border bg-muted sm:grid-cols-4">
                {specs.map(([k, v]) => (
                  <div key={k} className="flex min-w-0 flex-col gap-1 bg-card p-4">
                    <dt className="text-[13px] text-muted-foreground">{k}</dt>
                    <dd className="truncate text-lg font-bold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {moreFacts.length > 0 ? (
                <p className="text-sm text-muted-foreground">{moreFacts.join(" · ")}</p>
              ) : null}
            </div>

            {l.description ? (
              <section className="flex flex-col gap-2.5">
                <h2 className="text-xl font-bold">{t("ld_description")}</h2>
                <p className="max-w-[720px] text-base leading-[1.85] whitespace-pre-line text-pretty">
                  {l.description}
                </p>
              </section>
            ) : null}

            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-bold">{t("ld_features")}</h2>
              <ul className="flex flex-wrap gap-2">
                {features.map((a, i) => (
                  <li
                    key={`${i}-${a}`}
                    className="flex h-9 items-center gap-[7px] border border-border bg-card px-3 text-sm font-medium"
                  >
                    <Check className="size-3.5" aria-hidden />
                    {a}
                  </li>
                ))}
              </ul>
            </section>

            {l.lat != null && l.lng != null ? (
              <NearbyPlacesSection lat={l.lat} lng={l.lng} locale={locale} />
            ) : null}

            {l.purpose === "sale" && l.salePrice > 0 ? (
              <MortgageCalculator price={l.salePrice} locale={locale} />
            ) : null}

            {similar.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-bold">{t("ld_similar_near")}</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {similar.map((s) => (
                    <SimilarCard key={s.id} listing={s} from={l} locale={locale} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
            <AdvertiserCard
              advertiser={advertiser}
              inquiry={inquiry}
              locale={locale}
              onContactClick={onContactClick}
            />
            <div className="border border-border bg-card p-5">
              <UnitRequestForm
                unitType={l.unitType}
                district={l.district}
                city={l.office.city}
                officeId={l.office.id}
                officeName={l.office.name}
                purpose={l.purpose}
                locale={locale}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("ld_adv_note")}</p>
          </aside>
        </div>
      </main>

      {/* Phones: price and the two contact actions stay in reach while scrolling. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 bg-card px-3 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(32,30,29,.12)] lg:hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[17px] font-bold whitespace-nowrap tabular-nums">{priceMain}</span>
          <span className="text-xs text-muted-foreground">{priceUnit}</span>
        </div>
        {wa ? (
          <Button variant="whatsapp" size="lg" asChild className="px-4">
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              onClick={() => onContactClick("whatsapp")}
            >
              <MessageCircle aria-hidden />
              {t("card_whatsapp")}
            </a>
          </Button>
        ) : null}
        {tel ? (
          <Button variant="outline" asChild className="size-12 justify-center px-0">
            <a href={tel} onClick={() => onContactClick("call")} aria-label={t("card_call")}>
              <Phone aria-hidden />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
