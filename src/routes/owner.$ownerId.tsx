import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { AdvertiserPage, type AdvertiserPageData } from "@/components/advertiser-page";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toListing, type Listing } from "@/lib/market";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { mediaUrl } from "@/lib/unit-photos";

type OwnerPageResult =
  | { status: "ok"; page: AdvertiserPageData; listings: Listing[] }
  | { status: "missing" }
  | { status: "error" };

async function loadOwnerPage(ownerId: string): Promise<OwnerPageResult> {
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
  staticData: { sitemap: false },
  loader: ({ params }) => loadOwnerPage(params.ownerId),
  head: ({ loaderData }) => {
    if (loaderData?.status !== "ok") return { meta: [{ title: "صفحة مالك — جارك" }] };
    const { page } = loaderData;
    const title = `${page.name} — عروض عقارية على جارك`;
    return {
      meta: [
        { title },
        { name: "description", content: page.bio?.slice(0, 160) ?? `عروض ${page.name} على جارك` },
        { property: "og:title", content: title },
        ...(page.imageUrl ? [{ property: "og:image", content: page.imageUrl }] : []),
      ],
    };
  },
  component: OwnerPage,
});

function OwnerPage() {
  useTrackSiteVisit("/owner/$ownerId");
  const data = Route.useLoaderData();
  const router = useRouter();
  if (data.status !== "ok") {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-bold">
            {data.status === "error" ? "تعذّر تحميل الصفحة" : "هذه الصفحة غير متاحة"}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {data.status === "error"
              ? "تحقّق من الاتصال ثم أعد المحاولة."
              : "قد لا تكون منشورة بعد."}
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
