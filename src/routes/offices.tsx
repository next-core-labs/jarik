import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { LocateFixed, MessageCircle, Phone, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { distanceMeters } from "@/lib/map-markers";
import { phoneHref, whatsappHref } from "@/lib/market";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { arCount } from "@/lib/format";
import { SiteHeader } from "@/components/site-header";
import { ArchEmptyState, SquareLogo, VerifiedMark } from "@/components/public/identity";
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
  /** From office_pages_public (same listed + verified offices); null when it could not be read. */
  listings_count: number | null;
  avg_rating: number | null;
  ratings_count: number | null;
  whatsapp_number: string | null;
  /** Centre of the office's public listings (each already rounded to ~1 km) — null without any. */
  lat: number | null;
  lng: number | null;
  /** The office has a public page (a row in office_pages_public) — only then is /office/$id live. */
  hasPage: boolean;
};

async function loadOffices(): Promise<Office[]> {
  const [{ data, error }, stats, spots] = await Promise.all([
    supabase
      .from("office_directory")
      .select("id, company_name, fal_license_no, office_phone, city, district, logo_url"),
    supabase
      .from("office_pages_public")
      .select("id, listings_count, avg_rating, ratings_count, whatsapp_number"),
    // Offices have no coordinates of their own; where they list is where they work.
    supabase.from("vacant_units_public").select("office_id, lat, lng").limit(2000),
  ]);
  if (error) throw error;
  // The card stats are a nicety — a failed stats read leaves the directory itself intact.
  const statsById = new Map((stats.error ? [] : (stats.data ?? [])).map((s) => [s.id, s]));
  const centre = new Map<string, { lat: number; lng: number; n: number }>();
  for (const r of spots.error ? [] : (spots.data ?? [])) {
    if (!r.office_id || r.lat == null || r.lng == null) continue;
    const c = centre.get(r.office_id) ?? { lat: 0, lng: 0, n: 0 };
    centre.set(r.office_id, { lat: c.lat + Number(r.lat), lng: c.lng + Number(r.lng), n: c.n + 1 });
  }
  return (data ?? [])
    .filter((o): o is typeof o & { id: string; company_name: string } =>
      Boolean(o.id && o.company_name),
    )
    .map((o) => {
      const s = statsById.get(o.id);
      return {
        ...o,
        logo: o.logo_url
          ? supabase.storage.from("branding").getPublicUrl(o.logo_url).data.publicUrl
          : "",
        listings_count: s?.listings_count ?? null,
        avg_rating: s?.avg_rating ?? null,
        ratings_count: s?.ratings_count ?? null,
        whatsapp_number: s?.whatsapp_number ?? null,
        hasPage: Boolean(s),
        ...(() => {
          const c = centre.get(o.id);
          return c ? { lat: c.lat / c.n, lng: c.lng / c.n } : { lat: null, lng: null };
        })(),
      };
    });
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
      { property: "og:url", content: "https://jarak-ksa.com/offices" },
    ],
    links: [{ rel: "canonical", href: "https://jarak-ksa.com/offices" }],
    scripts: loaderData?.length
      ? [
          {
            type: "application/ld+json",
            children: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": loaderData.map((o) => ({
                "@type": "RealEstateAgent",
                name: o.company_name,
                // Only offices with a public page (office_pages_public) have a live /office URL.
                ...(o.hasPage
                  ? { url: `https://jarak-ksa.com/office/${encodeURIComponent(o.id)}` }
                  : {}),
                ...(o.office_phone ? { telephone: o.office_phone } : {}),
                ...(o.city || o.district
                  ? {
                      address: {
                        "@type": "PostalAddress",
                        ...(o.city ? { addressLocality: o.city } : {}),
                        ...(o.district ? { addressRegion: o.district } : {}),
                        addressCountry: "SA",
                      },
                    }
                  : {}),
                ...(o.logo.startsWith("https://") ? { image: o.logo } : {}),
              })),
            }),
          },
        ]
      : [],
  }),
  component: Offices,
});

function Offices() {
  useTrackSiteVisit("/offices");
  const [q, setQ] = useState("");
  const offices = Route.useLoaderData();
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const canNear = offices.some((o) => o.lat != null);

  function nearMe() {
    if (me) {
      setMe(null);
      return;
    }
    if (!navigator.geolocation) {
      toast.error("متصفحك لا يدعم تحديد الموقع");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {
        setLocating(false);
        toast.error("تعذّر تحديد موقعك — ابحث باسم الحي بدلًا من ذلك");
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  }

  const term = q.trim();
  const list = offices
    .filter(
      (o) =>
        !term ||
        (o.district ?? "").includes(term) ||
        (o.city ?? "").includes(term) ||
        o.company_name.includes(term),
    )
    .map((o) => ({
      o,
      km:
        me && o.lat != null && o.lng != null
          ? distanceMeters(me, { lat: o.lat, lng: o.lng }) / 1000
          : null,
    }))
    // Nearest first; offices with nothing listed (no location yet) keep their order at the end.
    .sort((a, b) => (me ? (a.km ?? Infinity) - (b.km ?? Infinity) : 0));

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 pt-9 pb-16">
        {/* "Near me" measures to where each office's public listings are (office_directory has no
            coordinates of its own), so it is offered only when at least one office has listings. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] leading-tight font-bold">المكاتب العقارية</h1>
            <p className="text-[15px] text-muted-foreground">
              مكاتب موثّقة برخصة فال — ابحث بالحي أو المدينة أو اسم المكتب.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {canNear ? (
              <button
                type="button"
                onClick={nearMe}
                aria-pressed={Boolean(me)}
                className={cn(
                  "flex h-11 items-center gap-2 border-[1.5px] border-foreground px-4 text-[15px] font-semibold whitespace-nowrap transition-colors",
                  me ? "bg-foreground text-background" : "bg-card hover:bg-muted",
                )}
              >
                <LocateFixed
                  className={cn("size-[18px]", me ? "text-[#FF6B50]" : "text-primary")}
                  aria-hidden
                />
                {locating ? "جارٍ تحديد موقعك…" : me ? "الأقرب إليك أولًا" : "المكاتب القريبة مني"}
              </button>
            ) : null}
            <div className="relative w-full sm:w-80">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="ps-9"
                placeholder="ابحث بالحي أو المدينة أو اسم المكتب"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="بحث في المكاتب"
              />
            </div>
          </div>
        </div>

        {list.length === 0 ? (
          <ArchEmptyState
            title={offices.length === 0 ? "لا توجد مكاتب مدرجة بعد" : "لا توجد مكاتب مطابقة لبحثك"}
            hint={
              offices.length === 0
                ? "ستظهر هنا المكاتب الموثّقة برخصة فال فور إدراجها."
                : "جرّب اسم حي أو مدينة أخرى، أو جزءًا من اسم المكتب."
            }
          >
            {term ? (
              <Button variant="outline" onClick={() => setQ("")}>
                مسح البحث
              </Button>
            ) : null}
          </ArchEmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {list.map(({ o, km }) => (
              <OfficeCard key={o.id} office={o} km={km} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function OfficeCard({ office: o, km }: { office: Office; km: number | null }) {
  const place = o.district ?? o.city;
  const idLine = [o.fal_license_no ? `فال ${o.fal_license_no}` : null, place]
    .filter(Boolean)
    .join(" · ");
  const wa = whatsappHref(
    o.whatsapp_number ?? o.office_phone,
    `مرحبًا ${o.company_name}، وصلت إليكم من دليل المكاتب في جارك`,
  );
  const showRating = o.avg_rating != null && (o.ratings_count ?? 0) >= 3;
  const tel = phoneHref(o.office_phone);

  return (
    <article className="flex flex-col border border-border bg-card">
      <div className="relative h-24 bg-foreground">
        <SquareLogo
          src={o.logo || null}
          name={o.company_name}
          className="absolute start-5 -bottom-7 size-16"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 px-5 pt-[38px] pb-5">
        <h2 className="flex items-center gap-1.5 text-[17px] font-bold">
          {o.hasPage ? (
            <Link
              to="/office/$officeId"
              params={{ officeId: o.id }}
              className="min-w-0 truncate hover:underline hover:underline-offset-4"
            >
              {o.company_name}
            </Link>
          ) : (
            <span className="min-w-0 truncate">{o.company_name}</span>
          )}
          {/* office_directory only lists offices the platform has verified. */}
          <VerifiedMark />
        </h2>
        {idLine ? <p className="text-[13px] text-muted-foreground tabular-nums">{idLine}</p> : null}
        {o.listings_count != null || showRating || km != null ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-semibold">
            {km != null ? (
              <span className="text-red-text tabular-nums">
                يبعد {km < 1 ? `${Math.round((km * 1000) / 10) * 10} م` : `${km.toFixed(1)} كم`}
              </span>
            ) : null}
            {o.listings_count != null ? (
              <span>
                {o.listings_count === 0
                  ? "لا عروض حاليًا"
                  : arCount(o.listings_count, {
                      one: "عرض واحد",
                      two: "عرضان",
                      few: "عروض",
                      many: "عرضًا",
                    })}
              </span>
            ) : null}
            {showRating ? (
              <span className="text-success-tint-foreground">جودة الصيانة {o.avg_rating}</span>
            ) : null}
          </div>
        ) : null}
        {wa || tel ? (
          <div className="mt-auto grid grid-cols-2 gap-2 pt-1.5">
            {wa ? (
              <Button variant="whatsapp" asChild className={tel ? undefined : "col-span-2"}>
                <a href={wa} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden />
                  واتساب
                </a>
              </Button>
            ) : null}
            {tel ? (
              <Button variant="outline" asChild className={wa ? undefined : "col-span-2"}>
                <a href={tel}>
                  <Phone aria-hidden />
                  اتصال
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}
        {o.hasPage ? (
          <Link
            to="/office/$officeId"
            params={{ officeId: o.id }}
            className="w-fit text-sm font-semibold underline underline-offset-4 hover:text-red-text"
          >
            كل عروض المكتب
          </Link>
        ) : null}
      </div>
    </article>
  );
}
