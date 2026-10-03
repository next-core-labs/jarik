import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { AdvertiserPage, type AdvertiserPageData } from "@/components/advertiser-page";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toListing, type Listing } from "@/lib/market";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { brandingUrl, mediaUrl } from "@/lib/unit-photos";

type OfficePageResult =
  | { status: "ok"; page: AdvertiserPageData; listings: Listing[] }
  | { status: "missing" }
  | { status: "error" };

async function loadOfficePage(officeId: string): Promise<OfficePageResult> {
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
  staticData: { sitemap: false },
  loader: ({ params }) => loadOfficePage(params.officeId),
  head: ({ loaderData, params }) => {
    if (loaderData?.status !== "ok") return { meta: [
      { title: "مكتب عقاري — جارك" },
      { name: "description", content: "تصفح المكاتب العقارية على جارك." },
      { property: "og:title", content: "مكتب عقاري — جارك" },
      { property: "og:description", content: "تصفح المكاتب العقارية على جارك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ] };
    const { page } = loaderData;
    const title = `${page.name} — عروض عقارية على جارك`;
    const description = page.bio?.slice(0, 160) ?? `عروض ${page.name} على جارك`;
    const url = `https://yourneighbor.app/office/${encodeURIComponent(params.officeId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(page.imageUrl?.startsWith("https://") ? [{ property: "og:image", content: page.imageUrl }, { name: "twitter:image", content: page.imageUrl }] : []),
        { name: "twitter:card", content: page.imageUrl?.startsWith("https://") ? "summary_large_image" : "summary" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [{
        type: "application/ld+json",
        children: JSON.stringify([
          {
            "@context": "https://schema.org", "@type": "RealEstateAgent",
            name: page.name, url,
            ...(page.phone ? { telephone: page.phone } : {}),
            ...(page.location ? { address: { "@type": "PostalAddress", addressLocality: page.location, addressCountry: "SA" } } : {}),
            ...(page.imageUrl?.startsWith("https://") ? { image: page.imageUrl } : {}),
          },
          {
            "@context": "https://schema.org", "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "دليل المكاتب العقارية", item: "https://yourneighbor.app/offices" },
              { "@type": "ListItem", position: 2, name: page.name, item: url },
            ],
          },
        ]),
      }],
    };
  },
  component: OfficePage,
});

function OfficePage() {
  useTrackSiteVisit("/office/$officeId");
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.status !== "ok") {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-bold">
            {data.status === "error" ? "تعذّر تحميل الصفحة" : "هذا المكتب غير متاح"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {data.status === "error"
              ? "تحقّق من الاتصال ثم أعد المحاولة."
              : "قد لا يعرض المكتب عروضه علنًا."}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            {data.status === "error" ? (
              <Button variant="outline" onClick={() => router.invalidate()}>
                إعادة المحاولة
              </Button>
            ) : null}
            <Button asChild>
              <Link to="/">العودة إلى سوق العروض</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }
  return <AdvertiserPage page={data.page} listings={data.listings} />;
}
