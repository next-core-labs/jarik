import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { LocateFixed, MessageCircle, Phone, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { distanceMeters } from "@/lib/map-markers";
import { phoneHref, whatsappHref } from "@/lib/market";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { listingsCount, publicNum } from "@/lib/format";
import {
  langSearch,
  localeFromSearch,
  useLocale,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import { distanceText } from "@/lib/market-format";
import { tf } from "@/components/listing-detail/format";
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
  staticData: { sitemap: true, publicLocale: true },
  loader: loadOffices,
  head: ({ loaderData, match }) => ({
    meta: [
      { title: tf(localeFromSearch(match.search), "meta_offices_title") },
      { name: "description", content: tf(localeFromSearch(match.search), "meta_offices_desc") },
      { property: "og:title", content: tf(localeFromSearch(match.search), "meta_offices_title") },
      {
        property: "og:description",
        content: tf(localeFromSearch(match.search), "meta_offices_og_desc"),
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
  const [locale] = useLocale();
  const t = (key: TranslationKey) => tf(locale, key);
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
      toast.error(t("offices_geo_unsupported"));
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
        toast.error(t("offices_geo_denied"));
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
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 pt-9 pb-16">
        {/* "Near me" measures to where each office's public listings are (office_directory has no
            coordinates of its own), so it is offered only when at least one office has listings. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] leading-tight font-bold">{t("offices_title")}</h1>
            <p className="text-[15px] text-muted-foreground">{t("offices_subtitle")}</p>
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
                {t(locating ? "near_locating" : me ? "offices_near_on" : "offices_near")}
              </button>
            ) : null}
            <div className="relative w-full sm:w-80">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="ps-9"
                placeholder={t("offices_search_ph")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={t("offices_search_aria")}
              />
            </div>
          </div>
        </div>

        {list.length === 0 ? (
          <ArchEmptyState
            title={t(offices.length === 0 ? "offices_empty_all" : "offices_empty_match")}
            hint={t(offices.length === 0 ? "offices_empty_all_hint" : "offices_empty_match_hint")}
          >
            {term ? (
              <Button variant="outline" onClick={() => setQ("")}>
                {t("search_clear")}
              </Button>
            ) : null}
          </ArchEmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-5 gap-y-9 pt-7">
            {list.map(({ o, km }) => (
              <OfficeCard key={o.id} office={o} km={km} locale={locale} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/** The QR on a pass. Drawn in the browser only, so the directory's HTML stays small. */
function PassQr({ value, label }: { value: string; label: string }) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void import("qrcode")
      .then((QR) => QR.toDataURL(value, { margin: 0, width: 264, errorCorrectionLevel: "M" }))
      .then((url) => {
        if (current) setImage(url);
      })
      // Without the code the pass still carries the same link in its name and footer.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [value]);
  return (
    <span className="grid size-[124px] place-items-center rounded-md bg-white p-2.5">
      {image ? <img src={image} alt={label} className="size-full" /> : null}
    </span>
  );
}

function PassField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-[11px] font-semibold text-background/60">{label}</dt>
      <dd className="min-w-0 text-[15px] leading-snug text-background/90">{children}</dd>
    </div>
  );
}

/** An office as a wallet pass: one solid ink card with a notch on top, the logo and licence in the
 *  header strip, label-over-value fields, and a QR that opens the office's page. */
function OfficeCard({
  office: o,
  km,
  locale,
}: {
  office: Office;
  km: number | null;
  locale: Locale;
}) {
  const t = (key: TranslationKey, vars?: Record<string, string | number>) => tf(locale, key, vars);
  const search = langSearch(locale);
  const place = [o.district, o.city].filter(Boolean).join(locale === "en" ? ", " : "، ");
  const wa = whatsappHref(
    o.whatsapp_number ?? o.office_phone,
    `مرحبًا ${o.company_name}، وصلت إليكم من دليل المكاتب في جارك`,
  );
  const showRating = o.avg_rating != null && (o.ratings_count ?? 0) >= 3;
  const tel = phoneHref(o.office_phone);
  // The code leads where the name leads: the office's own page, when it has one.
  const qr = o.hasPage ? `https://jarak-ksa.com/office/${encodeURIComponent(o.id)}` : null;

  return (
    <article className="relative flex flex-col overflow-hidden bg-foreground text-background shadow-[0_14px_28px_-14px_rgba(32,30,29,0.55)]">
      {/* The sheen and the notch are what make it read as a pass rather than a dark card. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.09)_0%,rgba(255,255,255,0)_45%)]"
      />
      <span
        aria-hidden
        className="absolute top-0 left-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background"
      />
      <div className="relative flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-16">
          <SquareLogo src={o.logo || null} name={o.company_name} className="size-12 border-0" />
          {o.fal_license_no ? (
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              <span className="text-[11px] font-semibold text-background/60">
                {t("offices_pass_fal")}
              </span>
              <span className="truncate text-lg leading-none font-semibold tabular-nums">
                {o.fal_license_no}
              </span>
            </div>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
            <dt className="text-[11px] font-semibold text-background/60">
              {t("offices_pass_name")}
            </dt>
            <dd>
              <h2 className="flex items-center gap-1.5 text-xl leading-snug font-bold">
                {o.hasPage ? (
                  <Link
                    to="/office/$officeId"
                    params={{ officeId: o.id }}
                    search={search}
                    className="min-w-0 truncate hover:underline hover:underline-offset-4"
                  >
                    {o.company_name}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate">{o.company_name}</span>
                )}
                {/* office_directory only lists offices the platform has verified. */}
                <VerifiedMark className="text-[#FF6B50]" />
              </h2>
            </dd>
          </div>
          {place || km != null ? (
            <PassField label={t("offices_pass_place")} className="col-span-2">
              <span className="block truncate">{place}</span>
              {km != null ? (
                <span className="block text-[13px] font-semibold text-[#FF6B50] tabular-nums">
                  {t("offices_distance", { d: distanceText(km, locale) })}
                </span>
              ) : null}
            </PassField>
          ) : null}
          {o.listings_count != null ? (
            <PassField label={t("offices_pass_listings")}>
              {o.listings_count === 0
                ? t("offices_no_listings")
                : listingsCount(o.listings_count, locale)}
            </PassField>
          ) : null}
          {showRating ? (
            <PassField label={t("offices_pass_rating")}>
              <span className="tabular-nums">
                {t("maint_quality", {
                  r: publicNum(o.avg_rating ?? 0, { maximumFractionDigits: 1 }),
                })}
              </span>
            </PassField>
          ) : null}
        </dl>

        <div className="mt-auto flex flex-col gap-4 pt-2">
          {qr ? (
            <div className="flex flex-col items-center gap-2">
              <PassQr value={qr} label={t("offices_pass_qr", { name: o.company_name })} />
              <span className="text-[11px] text-background/60">{t("offices_pass_scan")}</span>
            </div>
          ) : null}
          {wa || tel ? (
            <div className="grid grid-cols-2 gap-2">
              {wa ? (
                <Button variant="whatsapp" asChild className={tel ? undefined : "col-span-2"}>
                  <a href={wa} target="_blank" rel="noreferrer">
                    <MessageCircle aria-hidden />
                    {t("card_whatsapp")}
                  </a>
                </Button>
              ) : null}
              {tel ? (
                <Button
                  variant="outline"
                  asChild
                  className={cn(
                    "border-background/40 bg-transparent text-background hover:bg-background/10 hover:text-background",
                    wa ? undefined : "col-span-2",
                  )}
                >
                  <a href={tel}>
                    <Phone aria-hidden />
                    {t("card_call")}
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
          {o.hasPage ? (
            <Link
              to="/office/$officeId"
              params={{ officeId: o.id }}
              search={search}
              className="w-fit text-sm font-semibold underline underline-offset-4 hover:text-[#FF6B50]"
            >
              {t("offices_all_listings")}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}
