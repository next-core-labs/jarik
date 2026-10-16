import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { AdvertiserPage, type AdvertiserPageData } from "@/components/advertiser-page";
import { tf } from "@/components/listing-detail/format";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { langSearch, localeFromSearch, useLocale } from "@/lib/i18n";
import { toListing, type Listing } from "@/lib/market";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { brandingUrl, mediaUrl } from "@/lib/unit-photos";

type OfficePageResult =
  | { status: "ok"; page: AdvertiserPageData; listings: Listing[] }
  | { status: "missing" }
  | { status: "error" };

/** Public ids are uuids — anything else can't be a record (and PostgREST would fail with 22P02). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOfficePage(officeId: string): Promise<OfficePageResult> {
  if (!UUID_RE.test(officeId)) return { status: "missing" };
  try {
    const [pageRes, listingsRes] = await Promise.all([
      supabase.from("office_pages_public").select("*").eq("id", officeId).maybeSingle(),
      supabase.from("vacant_units_public").select("*").eq("office_id", officeId).limit(300),
    ]);
    if (pageRes.error || listingsRes.error) return { status: "error" };
    const row = pageRes.data;
    if (!row) return { status: "missing" };
    const listings = (listingsRes.data ?? [])
      .map(toListing)
      .filter((l): l is Listing => l !== null);
    return {
      status: "ok",
      listings,
      page: {
        kind: "office",
        name: row.company_name ?? "",
        imageUrl: row.logo_url ? brandingUrl(row.logo_url) : null,
        bannerUrl: row.banner_path ? mediaUrl(row.banner_path) : null,
        bio: row.bio,
        licenseNo: row.fal_license_no,
        location: [row.city, row.district].filter(Boolean).join(" · ") || null,
        phone: row.office_phone,
        whatsapp: row.whatsapp_number ?? row.office_phone,
        avgRating: row.avg_rating,
        ratingsCount: row.ratings_count,
      },
    };
  } catch {
    return { status: "error" };
  }
}

export const Route = createFileRoute("/office/$officeId")({
  staticData: { sitemap: false, publicLocale: true },
  loader: ({ params }) => loadOfficePage(params.officeId),
  head: ({ loaderData, params, match }) => {
    const locale = localeFromSearch(match.search);
    if (loaderData?.status !== "ok")
      return {
        meta: [
          { title: tf(locale, "meta_office_missing_title") },
          { name: "description", content: tf(locale, "meta_office_missing_desc") },
          { name: "robots", content: "noindex" },
          { property: "og:title", content: tf(locale, "meta_office_missing_title") },
          { property: "og:description", content: tf(locale, "meta_office_missing_desc") },
          { property: "og:type", content: "website" },
          { name: "twitter:card", content: "summary" },
        ],
      };
    const { page } = loaderData;
    const title = tf(locale, "meta_adv_title", { name: page.name });
    const description = page.bio?.slice(0, 160) ?? tf(locale, "meta_adv_desc", { name: page.name });
    const url = `https://jarak-ksa.com/office/${encodeURIComponent(params.officeId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(page.imageUrl?.startsWith("https://")
          ? [
              { property: "og:image", content: page.imageUrl },
              { name: "twitter:image", content: page.imageUrl },
            ]
          : []),
        {
          name: "twitter:card",
          content: page.imageUrl?.startsWith("https://") ? "summary_large_image" : "summary",
        },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "RealEstateAgent",
              name: page.name,
              url,
              ...(page.phone ? { telephone: page.phone } : {}),
              ...(page.location
                ? {
                    address: {
                      "@type": "PostalAddress",
                      addressLocality: page.location,
                      addressCountry: "SA",
                    },
                  }
                : {}),
              ...(page.imageUrl?.startsWith("https://") ? { image: page.imageUrl } : {}),
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  position: 1,
                  name: "دليل المكاتب العقارية",
                  item: "https://jarak-ksa.com/offices",
                },
                { "@type": "ListItem", position: 2, name: page.name, item: url },
              ],
            },
          ]),
        },
      ],
    };
  },
  component: OfficePage,
});

function OfficePage() {
  useTrackSiteVisit("/office/$officeId");
  const data = Route.useLoaderData();
  const router = useRouter();
  const [locale] = useLocale();
  if (data.status !== "ok") {
    const error = data.status === "error";
    return (
      <div
        dir={locale === "en" ? "ltr" : "rtl"}
        lang={locale}
        className="min-h-screen bg-background"
      >
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-bold">
            {tf(locale, error ? "page_error_title" : "office_missing_title")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {tf(locale, error ? "results_error_body" : "office_missing_body")}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            {error ? (
              <Button variant="outline" onClick={() => router.invalidate()}>
                {tf(locale, "results_retry")}
              </Button>
            ) : null}
            <Button asChild>
              <Link to="/" search={langSearch(locale)}>
                {tf(locale, "back_market")}
              </Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }
  return <AdvertiserPage page={data.page} listings={data.listings} />;
}
