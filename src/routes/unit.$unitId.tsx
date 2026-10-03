import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BedDouble, Bath, Check, ChevronLeft, MapPin, Ruler, Share2, Sofa } from "lucide-react";
import { toast } from "sonner";

import { AdvertiserCard, type AdvertiserView } from "@/components/advertiser-card";
import { inquiryText, ListingRow } from "@/components/listing-row";
import { MortgageCalculator } from "@/components/mortgage-calculator";
import { NearbyPlacesSection } from "@/components/nearby-places-section";
import { PhotoGallery } from "@/components/photo-gallery";
import { SiteHeader } from "@/components/site-header";
import { UnitRequestForm } from "@/components/unit-request-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { translate, useLocale } from "@/lib/i18n";
import { trackListingEvent } from "@/lib/office-tools.functions";
import { sar, shortDate } from "@/lib/format";
import {
  listingLocation,
  listingPrice,
  listingTitle,
  similarListings,
  toListing,
  type Listing,
  type ListingRow as ListingRowLike,
} from "@/lib/market";
import { PRICE_SUFFIX } from "@/lib/property-types";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { brandingUrl, mediaUrl } from "@/lib/unit-photos";

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
async function loadUnitPage(unitId: string): Promise<UnitPageData> {
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
  staticData: { sitemap: false },
  loader: ({ params }) => loadUnitPage(params.unitId),
  head: ({ loaderData, params }) => {
    if (loaderData?.status !== "ok") {
      return { meta: [
        { title: "عرض عقاري — جارك" },
        { name: "description", content: "تصفح العروض العقارية المتاحة على جارك." },
        { property: "og:title", content: "عرض عقاري — جارك" },
        { property: "og:description", content: "تصفح العروض العقارية المتاحة على جارك." },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ] };
    }
    const { listing: l, photos } = loaderData;
    const title = `${listingTitle(l)} — جارك`;
    const description = `${sar(listingPrice(l))}${PRICE_SUFFIX[l.purpose] ? " سنويًا" : ""}${l.rooms != null ? ` · ${l.rooms} غرف` : ""}${
      l.area ? ` · ${l.area} م²` : ""
    }${listingLocation(l) ? ` · ${listingLocation(l)}` : ""}. ${l.office.name}.`;
    const image = photos[0] ?? l.coverPath;
    const url = `https://yourneighbor.app/unit/${encodeURIComponent(params.unitId)}`;
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
      scripts: [{
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
            ...(l.area ? { floorSize: { "@type": "QuantitativeValue", value: l.area, unitCode: "MTK" } } : {}),
            ...(image ? { image: mediaUrl(image) } : {}),
            offers: {
              "@type": "Offer",
              price: listingPrice(l),
              priceCurrency: "SAR",
              availability: "https://schema.org/InStock",
              url,
              ...(l.purpose === "rent" ? { priceSpecification: {
                "@type": "UnitPriceSpecification", price: listingPrice(l), priceCurrency: "SAR",
                unitText: "YEAR",
              } } : {}),
            },
          },
          {
            "@context": "https://schema.org", "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "سوق العروض", item: "https://yourneighbor.app/" },
              { "@type": "ListItem", position: 2, name: listingTitle(l), item: url },
            ],
          },
        ]),
      }],
    };
  },
  component: UnitPublic,
});

function UnitPublic() {
  useTrackSiteVisit("/unit/$unitId");
  const data = Route.useLoaderData();
  const router = useRouter();
  const [locale, setLocale] = useLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  const unitId = data.status === "ok" ? data.listing.id : null;
  const track = useServerFn(trackListingEvent);
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
        <SiteHeader locale={locale} onLocaleChange={setLocale} />
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
              <Link to="/">{locale === "en" ? "Back to the market" : "العودة إلى سوق العروض"}</Link>
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

  const info: [string, string | null][] = [
    [t("info_type"), l.unitType],
    [t("info_unit_no"), l.unitNumber],
    [t("info_floor"), l.floorNo],
    [t("info_rooms"), l.rooms != null ? String(l.rooms) : null],
    [t("info_halls"), l.halls > 0 ? String(l.halls) : null],
    [t("info_bathrooms"), l.bathrooms > 0 ? String(l.bathrooms) : null],
    [t("info_area"), l.area ? `${l.area} ${locale === "en" ? "m²" : "م²"}` : null],
    [t("info_furnished"), l.furnished ? t("filter_furnished_yes") : t("filter_furnished_no")],
    [t("info_added"), l.createdAt ? shortDate(l.createdAt) : null],
  ];

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader locale={locale} onLocaleChange={setLocale} />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <nav
          aria-label={locale === "en" ? "Breadcrumb" : "مسار التنقل"}
          className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          <Link to="/" className="hover:underline">
            {t("unit_breadcrumb")}
          </Link>
          {l.district ? (
            <>
              <ChevronLeft className="size-3.5" aria-hidden />
              <span>{locale === "en" ? l.district : `حي ${l.district}`}</span>
            </>
          ) : null}
          <ChevronLeft className="size-3.5" aria-hidden />
          <span className="text-foreground">{title}</span>
        </nav>

        <PhotoGallery paths={photos} alt={title} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-8">
            <section>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="font-display text-3xl font-bold">
                  {sar(listingPrice(l))}
                  {l.purpose === "rent" ? (
                    <span className="ms-2 text-base font-normal text-muted-foreground">
                      {locale === "en" ? t("unit_yearly") : PRICE_SUFFIX[l.purpose]}
                    </span>
                  ) : null}
                </p>
                <Button variant="outline" size="sm" onClick={share}>
                  <Share2 className="size-4" />
                  {t("unit_share")}
                </Button>
              </div>
              <h1 className="mt-2 font-display text-xl font-bold md:text-2xl">{title}</h1>
              {location ? (
                <p className="mt-2 flex items-center gap-1.5 text-muted-foreground">
                  <MapPin className="size-4 text-brass" aria-hidden />
                  {location}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                {l.rooms != null ? (
                  <Spec icon={<BedDouble className="size-4" aria-hidden />}>
                    {l.rooms} {t("info_rooms")}
                  </Spec>
                ) : null}
                {l.bathrooms > 0 ? (
                  <Spec icon={<Bath className="size-4" aria-hidden />}>
                    {l.bathrooms} {t("info_bathrooms")}
                  </Spec>
                ) : null}
                {l.area ? (
                  <Spec icon={<Ruler className="size-4" aria-hidden />}>
                    {l.area} {locale === "en" ? "m²" : "م²"}
                  </Spec>
                ) : null}
                <Spec icon={<Sofa className="size-4" aria-hidden />}>
                  {l.furnished ? t("filter_furnished_yes") : t("filter_furnished_no")}
                </Spec>
              </div>
            </section>

            {l.description ? (
              <section>
                <h2 className="mb-2 font-display text-lg font-bold">{t("unit_about")}</h2>
                <p className="leading-relaxed whitespace-pre-line text-foreground/90">
                  {l.description}
                </p>
              </section>
            ) : null}

            <section>
              <h2 className="mb-2 font-display text-lg font-bold">{t("unit_info")}</h2>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                {info
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between border-b border-border py-2 text-sm"
                    >
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
              </dl>
            </section>

            {l.lat != null && l.lng != null ? (
              <NearbyPlacesSection lat={l.lat} lng={l.lng} />
            ) : null}

            {l.purpose === "sale" && l.salePrice > 0 ? (
              <MortgageCalculator price={l.salePrice} />
            ) : null}

            {l.amenities.length > 0 ? (
              <section>
                <h2 className="mb-3 font-display text-lg font-bold">{t("unit_amenities")}</h2>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {l.amenities.map((a) => (
                    <li
                      key={a}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
                    >
                      <Check className="size-4 text-success" aria-hidden />
                      {a}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <Card className="shadow-deed">
              <CardContent className="py-6">
                <UnitRequestForm
                  unitType={l.unitType}
                  district={l.district}
                  city={l.office.city}
                  officeId={l.office.id}
                  purpose={l.purpose}
                />
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <AdvertiserCard
              advertiser={advertiser}
              inquiry={inquiryText(l)}
              onContactClick={(kind) =>
                track({
                  data: {
                    unitId: l.id,
                    eventType: kind === "call" ? "call_click" : "whatsapp_click",
                  },
                }).catch(() => {})
              }
            />
            <p className="rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
              {locale === "en"
                ? "Contact the advertiser directly for viewing and details. Verify all information before any payment."
                : "تواصل مع المعلن مباشرة للمعاينة والتفاصيل. تأكد من صحة البيانات قبل أي دفع."}
            </p>
          </aside>
        </div>

        {similar.length > 0 ? (
          <section className="mt-12">
            <h2 className="mb-4 font-display text-xl font-bold">{t("unit_similar")}</h2>
            <div className="space-y-4">
              {similar.map((s) => (
                <ListingRow key={s.id} listing={s} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Spec({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-border bg-card px-3 py-1.5">
      {icon}
      {children}
    </span>
  );
}
