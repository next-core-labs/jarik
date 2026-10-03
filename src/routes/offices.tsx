import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, MapPin, Phone, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Office = {
  id: string;
  company_name: string;
  fal_license_no: string | null;
  office_phone: string | null;
  city: string | null;
  district: string | null;
  logo_url: string | null;
  logo: string;
};

async function loadOffices(): Promise<Office[]> {
  const { data, error } = await supabase
    .from("office_directory")
    .select("id, company_name, fal_license_no, office_phone, city, district, logo_url");
  if (error) throw error;
  return (data ?? []).filter((o): o is typeof o & { id: string; company_name: string } => Boolean(o.id && o.company_name)).map((o) => ({
    ...o,
    logo: o.logo_url ? supabase.storage.from("branding").getPublicUrl(o.logo_url).data.publicUrl : "",
  }));
}

export const Route = createFileRoute("/offices")({
  staticData: { sitemap: true },
  loader: loadOffices,
  head: ({ loaderData }) => ({
    meta: [
      { title: "دليل المكاتب العقارية — جارك" },
      {
        name: "description",
        content: "ابحث عن المكاتب العقارية في حيّك وشاهد شعار كل مكتب ورقم ترخيص فال ورقم جواله.",
      },
      { property: "og:title", content: "دليل المكاتب العقارية — جارك" },
      {
        property: "og:description",
        content: "مكاتب عقارية موثّقة بترخيص فال مع بيانات التواصل حسب الحي.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "https://yourneighbor.app/offices" },
    ],
    links: [{ rel: "canonical", href: "https://yourneighbor.app/offices" }],
    scripts: loaderData?.length ? [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org", "@graph": loaderData.map((o) => ({
          "@type": "RealEstateAgent",
          name: o.company_name,
          url: `https://yourneighbor.app/office/${encodeURIComponent(o.id)}`,
          ...(o.office_phone ? { telephone: o.office_phone } : {}),
          ...(o.city || o.district ? { address: {
            "@type": "PostalAddress", ...(o.city ? { addressLocality: o.city } : {}),
            ...(o.district ? { addressRegion: o.district } : {}), addressCountry: "SA",
          } } : {}),
          ...(o.logo.startsWith("https://") ? { image: o.logo } : {}),
        })),
      }),
    }] : [],
  }),
  component: Offices,
});

function Offices() {
  useTrackSiteVisit("/offices");
  const [q, setQ] = useState("");
  const offices = Route.useLoaderData();

  const term = q.trim();
  const list = offices.filter(
    (o) =>
      !term ||
      (o.district ?? "").includes(term) ||
      (o.city ?? "").includes(term) ||
      o.company_name.includes(term),
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="font-display text-3xl font-bold">دليل المكاتب العقارية</h1>
      <p className="mt-2 text-muted-foreground">
        اختر الحي لتظهر لك المكاتب العقارية فيه مع شعار كل مكتب ورقم ترخيص فال وبيانات التواصل.
      </p>

      <div className="mt-6 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pe-9"
            placeholder="ابحث بالحي أو المدينة أو اسم المكتب"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="outline" asChild>
          <Link to="/auth">دخول المكاتب</Link>
        </Button>
      </div>

      <div className="mt-8 space-y-4">
        {list.map((o) => (
            <Card key={o.id} className="shadow-deed">
              <CardContent className="flex flex-wrap items-center gap-4 py-5">
                {o.logo ? (
                  <img
                    src={o.logo}
                    alt={`شعار ${o.company_name}`}
                    className="h-16 w-16 rounded-md object-contain"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                    {o.company_name.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-40 flex-1">
                  <p className="font-display text-lg font-bold">{o.company_name}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="size-4 text-brass" />
                    {[o.city, o.district].filter(Boolean).join(" · ") || "غير محدّد"}
                  </p>
                </div>
                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <BadgeCheck className="size-4 text-brass" />
                    ترخيص فال: <span dir="ltr">{o.fal_license_no ?? "—"}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Phone className="size-4 text-brass" />
                    <span dir="ltr">{o.office_phone ?? "—"}</span>
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد مكاتب مطابقة لبحثك.</p>
        ) : null}
      </div>
    </main>
  );
}
