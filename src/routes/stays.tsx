import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BedDouble, Clock, ImageOff, MapPin, Search, Users } from "lucide-react";

import { tf } from "@/components/listing-detail/format";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { publicCount, publicNum, publicSar } from "@/lib/format";
import { langSearch, localeFromSearch, useLocale, type TranslationKey } from "@/lib/i18n";
import { mediaUrl } from "@/lib/unit-photos";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";

/**
 * سوق الحجز اليومي — منفصل عن سوق الإيجار السنوي عن قصد: الوحدة هنا تُحجز بالليلة ولها سعر ليلة،
 * ولا سعر سنوي. القاعدة لا تعرض إلا وحدة بسعر ليلة ورخصة إيواء سياحي (bookable_units_public).
 */

type Stay = {
  id: string;
  unit_type: string | null;
  unit_name: string | null;
  city: string | null;
  district: string | null;
  rooms: number | null;
  bathrooms: number | null;
  area: number | null;
  nightly_rate: number | null;
  weekend_rate: number | null;
  min_nights: number | null;
  max_guests: number | null;
  checkin_time: string | null;
  checkout_time: string | null;
  cover_path: string | null;
  company_name: string | null;
  featured: boolean | null;
};

async function loadStays(): Promise<Stay[]> {
  const { data, error } = await supabase
    .from("bookable_units_public")
    .select(
      "id, unit_type, unit_name, city, district, rooms, bathrooms, area, nightly_rate, weekend_rate, min_nights, max_guests, checkin_time, checkout_time, cover_path, company_name, featured",
    )
    .limit(500);
  if (error) throw error;
  return (data ?? []).filter((r): r is Stay => Boolean(r.id));
}

export const Route = createFileRoute("/stays")({
  staticData: { sitemap: true, publicLocale: true },
  loader: loadStays,
  head: ({ loaderData, match }) => {
    const locale = localeFromSearch(match.search);
    const title = `${tf(locale, "bk_section_title")} — ${locale === "en" ? "Jarak" : "جارك"}`;
    const description = tf(locale, "bk_section_sub");
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { property: "og:url", content: "https://jarak-ksa.com/stays" },
      ],
      links: [{ rel: "canonical", href: "https://jarak-ksa.com/stays" }],
      // نفس بيانات الصفحة المنشورة — قاعدة AGENTS.md.
      scripts: loaderData?.length
        ? [
            {
              type: "application/ld+json",
              children: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "ItemList",
                name: tf(locale, "bk_section_title"),
                itemListElement: loaderData.map((s, i) => ({
                  "@type": "ListItem",
                  position: i + 1,
                  name:
                    [s.unit_type, s.district, s.city].filter(Boolean).join(" · ") || "وحدة للحجز",
                  url: `https://jarak-ksa.com/unit/${encodeURIComponent(s.id)}`,
                })),
              }),
            },
          ]
        : [],
    };
  },
  component: Stays,
});

function Stays() {
  useTrackSiteVisit("/stays");
  const [locale] = useLocale();
  const t = (key: TranslationKey) => tf(locale, key);
  const all = Route.useLoaderData();
  const search = langSearch(locale);
  const [q, setQ] = useState("");
  const [city, setCity] = useState("all");

  const cities = useMemo(
    () =>
      [...new Set(all.map((s) => s.city).filter((c): c is string => Boolean(c)))].sort((a, b) =>
        a.localeCompare(b, "ar"),
      ),
    [all],
  );

  const rows = useMemo(() => {
    const term = q.trim();
    return all
      .filter((s) => city === "all" || s.city === city)
      .filter(
        (s) =>
          !term ||
          [s.unit_type, s.unit_name, s.district, s.city, s.company_name]
            .filter(Boolean)
            .some((v) => v!.includes(term)),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
          Number(a.nightly_rate ?? 0) - Number(b.nightly_rate ?? 0),
      );
  }, [all, q, city]);

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 pt-9 pb-16">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] leading-tight font-bold">{t("bk_section_title")}</h1>
          <p className="text-[15px] text-muted-foreground">{t("bk_section_sub")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("search_placeholder")}
              aria-label={t("search_aria")}
              className="h-10 ps-9"
            />
          </div>
          <Select value={city} onValueChange={setCity}>
            <SelectTrigger aria-label={t("prices_city")} className="h-10 w-auto min-w-[140px]">
              <SelectValue placeholder={t("pj_city_all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("pj_city_all")}</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-sm text-muted-foreground tabular-nums">
          {publicCount(
            rows.length,
            locale,
            { one: "وحدة واحدة", two: "وحدتان", few: "وحدات", many: "وحدة" },
            { one: "unit", many: "units" },
          )}
        </p>

        {rows.length === 0 ? (
          // حالة فارغة بلا مخرج كانت طريقًا مسدودًا — تقود الآن إلى سوق العروض.
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-5 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("bk_empty")}</p>
            <Link
              to="/"
              search={search}
              className="flex h-10 items-center bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("adv_browse_all")}
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((s) => {
              const cover = s.cover_path ? mediaUrl(s.cover_path) : null;
              const where = [s.district ? `حي ${s.district}` : null, s.city]
                .filter(Boolean)
                .join(" · ");
              return (
                <article
                  key={s.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-deed transition-shadow hover:shadow-e1"
                >
                  <Link
                    to="/unit/$unitId"
                    params={{ unitId: s.id }}
                    search={search}
                    className="relative mx-2.5 mt-2.5 block aspect-[16/9] overflow-hidden rounded-arch bg-muted"
                    aria-label={s.unit_type ?? "وحدة"}
                  >
                    {cover ? (
                      <img
                        src={cover}
                        alt={s.unit_type ?? ""}
                        loading="lazy"
                        className="size-full object-cover grayscale contrast-[1.08]"
                      />
                    ) : (
                      <span className="grid size-full place-content-center text-muted-foreground">
                        <ImageOff className="size-9 opacity-50" aria-hidden />
                      </span>
                    )}
                    <span className="absolute start-2.5 bottom-2.5 flex gap-1">
                      {s.featured ? (
                        <Badge className="bg-foreground text-background hover:bg-foreground">
                          {t("badge_featured")}
                        </Badge>
                      ) : null}
                      <Badge className="bg-brass text-brass-foreground hover:bg-brass">
                        {t("nav_booking")}
                      </Badge>
                    </span>
                  </Link>

                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
                    <Link
                      to="/unit/$unitId"
                      params={{ unitId: s.id }}
                      search={search}
                      className="truncate font-bold underline-offset-4 hover:underline"
                    >
                      {s.unit_name || s.unit_type || "وحدة"}
                    </Link>
                    {where ? (
                      <p className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0 text-brass" aria-hidden />
                        <span className="truncate">{where}</span>
                      </p>
                    ) : null}
                    <p className="flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
                      {s.rooms ? (
                        <span className="flex items-center gap-1">
                          <BedDouble className="size-3.5" aria-hidden />
                          {publicNum(s.rooms)}
                        </span>
                      ) : null}
                      {s.max_guests ? (
                        <span className="flex items-center gap-1">
                          <Users className="size-3.5" aria-hidden />
                          {publicNum(s.max_guests)}
                        </span>
                      ) : null}
                      {s.checkin_time ? (
                        <span className="flex items-center gap-1">
                          <Clock className="size-3.5" aria-hidden />
                          {s.checkin_time.slice(0, 5)}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-auto pt-1 text-[13px] text-muted-foreground">
                      {t("bk_from")}{" "}
                      <span className="text-[17px] font-bold text-foreground tabular-nums">
                        {publicSar(Number(s.nightly_rate ?? 0), locale)}
                      </span>{" "}
                      {t("bk_per_night")}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
