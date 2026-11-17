import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { tf } from "@/components/listing-detail/format";
import { SiteHeader } from "@/components/site-header";
import {
  districtPricesPath,
  historySeries,
  loadDistrictHistory,
  loadDistrictPrices,
  purposeAverages,
  seriesTrend,
  type PriceHistoryRow,
  type PricePoint,
  type PriceStat,
} from "@/lib/district-prices";
import { publicCount, publicNum, publicSar } from "@/lib/format";
import {
  langSearch,
  localeFromSearch,
  useLocale,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";

type DistrictPrices = {
  city: string;
  district: string;
  stats: PriceStat[];
  /** كل إحصاءات المدينة — مادة «قارن مع حي آخر». */
  cityStats: PriceStat[];
  /** لقطات district_price_history اليومية — مادة رسم «تغيّر متوسط السعر». */
  history: PriceHistoryRow[];
};

/** صفحة أسعار حي واحد: متوسط ونطاق السعر المطلوب لكل نوع وحدة، إيجارًا وبيعًا، وتغيّره زمنيًا. */
export const Route = createFileRoute("/prices/$city/$district")({
  staticData: { sitemap: false, publicLocale: true },
  loader: async ({ params }): Promise<DistrictPrices> => {
    // loadDistrictPrices يقرأ الجدول كاملًا (صغير) — أبسط من مطابقة ترميز العربية في eq().
    const all = await loadDistrictPrices();
    const stats = all.filter((s) => s.city === params.city && s.district === params.district);
    if (stats.length === 0) throw notFound();
    // الرسم إضافة اختيارية: صفحة الأسعار تعمل وإن تعذّر تاريخها.
    const history = await loadDistrictHistory(params.city, params.district).catch(
      () => [] as PriceHistoryRow[],
    );
    return {
      city: params.city,
      district: params.district,
      stats,
      cityStats: all.filter((s) => s.city === params.city),
      history,
    };
  },
  head: ({ loaderData, match }) => {
    const locale = localeFromSearch(match.search);
    if (!loaderData) {
      return { meta: [{ name: "robots", content: "noindex" }] };
    }
    const { city, district } = loaderData;
    const vars = { city, district };
    const title = `${tf(locale, "prices_district_title", vars)} — ${locale === "en" ? "Jarak" : "جارك"}`;
    const description = tf(locale, "prices_district_sub", vars);
    const url = `https://jarak-ksa.com${districtPricesPath(city, district)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
      // نفس بيانات الصفحة المنشورة (loaderData) — قاعدة AGENTS.md للبيانات المنظّمة.
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: tf(locale, "prices_home"),
                item: "https://jarak-ksa.com/",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: tf(locale, "prices_title"),
                item: "https://jarak-ksa.com/prices",
              },
              { "@type": "ListItem", position: 3, name: `${district} — ${city}`, item: url },
            ],
          }),
        },
      ],
    };
  },
  component: DistrictPricesPage,
});

function StatsTable({
  rows,
  locale,
  t,
}: {
  rows: PriceStat[];
  locale: "ar" | "en";
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="px-4 py-3 text-start font-medium">{t("prices_type")}</th>
            <th className="px-4 py-3 text-start font-medium">{t("prices_listings")}</th>
            <th className="px-4 py-3 text-start font-medium">
              {rows[0]?.purpose === "sale" ? t("prices_avg_sale") : t("prices_avg_rent")}
            </th>
            <th className="px-4 py-3 text-start font-medium">{t("prices_range")}</th>
            <th className="px-4 py-3 text-start font-medium">{t("prices_avg_area")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((s) => (
            <tr key={`${s.purpose}-${s.unitType}`}>
              <td className="px-4 py-3 font-semibold">{s.unitType}</td>
              <td className="px-4 py-3 tabular-nums">{s.listings}</td>
              <td className="px-4 py-3 font-semibold tabular-nums">
                {publicSar(s.avgPrice, locale)}
              </td>
              <td className="px-4 py-3 tabular-nums" dir="ltr">
                {publicSar(s.minPrice, locale)} – {publicSar(s.maxPrice, locale)}
              </td>
              <td className="px-4 py-3 tabular-nums">
                {s.avgArea != null ? `${publicNum(s.avgArea)} ${t("unit_sqm")}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** رسم خطي بسيط بـSVG — يُصيَّر من الخادم أيضًا (SSR) بلا مكتبة رسوم في صفحة عامة. */
function TrendChart({ points, locale }: { points: PricePoint[]; locale: Locale }) {
  const w = 640;
  const h = 150;
  const px = 4;
  const py = 12;
  const values = points.map((p) => p.avgPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const x = (i: number) => px + (i * (w - 2 * px)) / Math.max(points.length - 1, 1);
  const y = (v: number) => h - py - ((v - min) * (h - 2 * py)) / span;
  const line = points
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.avgPrice).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${h - 2} L${x(0).toFixed(1)},${h - 2} Z`;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-GB" : "ar", {
      day: "numeric",
      month: "short",
    });
  return (
    <figure dir="ltr" className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${publicSar(first.avgPrice, locale)} → ${publicSar(last.avgPrice, locale)}`}
        className="h-auto w-full"
      >
        <path d={area} className="fill-brass/15" />
        <path d={line} className="fill-none stroke-brass" strokeWidth={2.5} />
        <circle cx={x(points.length - 1)} cy={y(last.avgPrice)} r={4} className="fill-brass" />
      </svg>
      <figcaption className="flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {dateLabel(first.date)} · {publicSar(first.avgPrice, locale)}
        </span>
        <span className="font-semibold text-foreground">
          {dateLabel(last.date)} · {publicSar(last.avgPrice, locale)}
        </span>
      </figcaption>
    </figure>
  );
}

function TrendBlock({
  points,
  locale,
  t,
}: {
  points: PricePoint[];
  locale: Locale;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const trend = seriesTrend(points);
  // نقطة واحدة لا ترسم خطًا — يظهر الرسم مع تراكم اللقطات اليومية.
  if (points.length < 2) return null;
  const pctLabel = trend
    ? trend.pct > 0
      ? t("prices_trend_up", { pct: publicNum(trend.pct) })
      : trend.pct < 0
        ? t("prices_trend_down", { pct: publicNum(Math.abs(trend.pct)) })
        : t("prices_trend_flat")
    : null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("prices_trend_title")}</h3>
        {trend && pctLabel ? (
          <span
            className={`text-xs font-semibold ${
              trend.pct > 0
                ? "text-destructive"
                : trend.pct < 0
                  ? "text-success"
                  : "text-muted-foreground"
            }`}
          >
            {t("prices_trend_delta", {
              pct: pctLabel,
              days: publicCount(
                trend.days,
                locale,
                { one: "يوم واحد", two: "يومين", few: "أيام", many: "يومًا" },
                { one: "day", many: "days" },
              ),
            })}
          </span>
        ) : null}
      </div>
      <TrendChart points={points} locale={locale} />
    </div>
  );
}

/** «قارن مع حي آخر» في نفس المدينة: متوسطا الإيجار والبيع جنبًا إلى جنب مع الفرق. */
function CompareBlock({
  city,
  district,
  stats,
  cityStats,
  locale,
  t,
}: {
  city: string;
  district: string;
  stats: PriceStat[];
  cityStats: PriceStat[];
  locale: Locale;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}) {
  const others = useMemo(() => {
    const totals = new Map<string, number>();
    for (const s of cityStats) {
      if (s.district === district) continue;
      totals.set(s.district, (totals.get(s.district) ?? 0) + s.listings);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"))
      .map(([name]) => name);
  }, [cityStats, district]);
  const [other, setOther] = useState("");
  if (others.length === 0) return null;

  const a = purposeAverages(stats);
  const b = other ? purposeAverages(cityStats.filter((s) => s.district === other)) : null;
  const diff = (av: number | null, bv: number | null) =>
    av && bv ? Math.round(((bv - av) / av) * 100) : null;
  const rows = b
    ? [
        { label: t("prices_avg_rent"), a: a.avgRent, b: b.avgRent, d: diff(a.avgRent, b.avgRent) },
        { label: t("prices_avg_sale"), a: a.avgSale, b: b.avgSale, d: diff(a.avgSale, b.avgSale) },
      ].filter((r) => r.a !== null || r.b !== null)
    : [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">{t("prices_compare")}</h2>
        <select
          value={other}
          onChange={(e) => setOther(e.target.value)}
          aria-label={t("prices_compare")}
          className="h-10 border border-input bg-card px-3 text-sm focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none"
        >
          <option value="">{t("prices_compare_none")}</option>
          {others.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {other && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-4 py-3 text-start font-medium">
                  {t("prices_compare_title", { a: district, b: other })}
                </th>
                <th className="px-4 py-3 text-start font-medium">{district}</th>
                <th className="px-4 py-3 text-start font-medium">
                  <Link
                    to="/prices/$city/$district"
                    params={{ city, district: other }}
                    search={langSearch(locale)}
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {other}
                  </Link>
                </th>
                <th className="px-4 py-3 text-start font-medium">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="px-4 py-3 font-semibold">{r.label}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.a !== null ? publicSar(r.a, locale) : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.b !== null ? publicSar(r.b, locale) : "—"}
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums" dir="ltr">
                    {r.d !== null ? `${r.d > 0 ? "+" : ""}${publicNum(r.d)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function DistrictPricesPage() {
  const { city, district, stats, cityStats, history } = Route.useLoaderData();
  useTrackSiteVisit(districtPricesPath(city, district));
  const [locale] = useLocale();
  const t = (key: TranslationKey, vars: Record<string, string | number> = {}) =>
    tf(locale, key, vars);
  const search = langSearch(locale);
  const rent = stats.filter((s) => s.purpose === "rent").sort((a, b) => b.listings - a.listings);
  const sale = stats.filter((s) => s.purpose === "sale").sort((a, b) => b.listings - a.listings);
  const rentSeries = useMemo(() => historySeries(history, "rent"), [history]);
  const saleSeries = useMemo(() => historySeries(history, "sale"), [history]);

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-8 px-5 pt-9 pb-16">
        <nav className="text-sm text-muted-foreground" aria-label="breadcrumb">
          <Link to="/prices" search={search} className="underline-offset-4 hover:underline">
            {t("prices_title")}
          </Link>{" "}
          / <span className="text-foreground">{district}</span>
        </nav>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[32px] leading-tight font-bold">
              {t("prices_district_title", { city, district })}
            </h1>
            <p className="text-[15px] text-muted-foreground">
              {t("prices_district_sub", { city, district })}
            </p>
          </div>
          <Link
            to="/"
            search={search}
            className="flex h-10 items-center bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("prices_view_listings")}
          </Link>
        </div>

        {rent.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">{t("prices_rent_section")}</h2>
            <TrendBlock points={rentSeries} locale={locale} t={t} />
            <StatsTable rows={rent} locale={locale} t={t} />
          </section>
        ) : null}
        {sale.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">{t("prices_sale_section")}</h2>
            <TrendBlock points={saleSeries} locale={locale} t={t} />
            <StatsTable rows={sale} locale={locale} t={t} />
          </section>
        ) : null}

        <CompareBlock
          city={city}
          district={district}
          stats={stats}
          cityStats={cityStats}
          locale={locale}
          t={t}
        />

        <p className="text-xs text-muted-foreground">{t("prices_disclaimer")}</p>
      </main>
    </div>
  );
}
