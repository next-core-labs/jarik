import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { AdvertiserPage, type AdvertiserPageData } from "@/components/advertiser-page";
import { tf } from "@/components/listing-detail/format";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { langSearch, localeFromSearch, useLocale } from "@/lib/i18n";
import { toListing, type Listing } from "@/lib/market";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { mediaUrl } from "@/lib/unit-photos";

type OwnerPageResult =
  | { status: "ok"; page: AdvertiserPageData; listings: Listing[] }
  | { status: "missing" }
  | { status: "error" };

/** Public ids are uuids — anything else can't be a record (and PostgREST would fail with 22P02). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOwnerPage(ownerId: string): Promise<OwnerPageResult> {
  if (!UUID_RE.test(ownerId)) return { status: "missing" };
  try {
    const [pageRes, listingsRes] = await Promise.all([
      supabase.from("owner_pages_public").select("*").eq("owner_id", ownerId).maybeSingle(),
      supabase.from("vacant_units_public").select("*").eq("owner_page_id", ownerId).limit(200),
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
        kind: "owner",
        name: row.display_name ?? "",
        imageUrl: row.avatar_path ? mediaUrl(row.avatar_path) : null,
        bannerUrl: null,
        bio: row.bio,
        areas: row.areas,
        propertyTypes: row.property_types,
        publishedBy: listings[0]?.office.name ?? null,
        phone: row.phone,
        whatsapp: row.whatsapp,
      },
    };
  } catch {
    return { status: "error" };
  }
}

export const Route = createFileRoute("/owner/$ownerId")({
  staticData: { sitemap: false, publicLocale: true },
  loader: ({ params }) => loadOwnerPage(params.ownerId),
  head: ({ loaderData, params, match }) => {
    const locale = localeFromSearch(match.search);
    if (loaderData?.status !== "ok")
      return {
        meta: [
          { title: tf(locale, "meta_owner_missing_title") },
          { name: "robots", content: "noindex" },
        ],
      };
    const { page } = loaderData;
    const title = tf(locale, "meta_adv_title", { name: page.name });
    const url = `https://jarak-ksa.com/owner/${encodeURIComponent(params.ownerId)}`;
    return {
      meta: [
        { title },
        {
          name: "description",
          content: page.bio?.slice(0, 160) ?? tf(locale, "meta_adv_desc", { name: page.name }),
        },
        { property: "og:title", content: title },
        { property: "og:url", content: url },
        ...(page.imageUrl ? [{ property: "og:image", content: page.imageUrl }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: OwnerPage,
});

function OwnerPage() {
  useTrackSiteVisit("/owner/$ownerId");
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
            {tf(locale, error ? "page_error_title" : "owner_missing_title")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {tf(locale, error ? "results_error_body" : "owner_missing_body")}
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
