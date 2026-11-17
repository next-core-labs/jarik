import { createFileRoute, Link } from "@tanstack/react-router";

import { tf } from "@/components/listing-detail/format";
import { SiteHeader } from "@/components/site-header";
import {
  districtPricesPath,
  groupByCity,
  loadDistrictPrices,
  type CitySummary,
} from "@/lib/district-prices";
import { publicSar } from "@/lib/format";
import { langSearch, localeFromSearch, useLocale, type TranslationKey } from "@/lib/i18n";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";

/**
 * أسعار الأحياء للعامة — مثل «أسعار الأحياء» في aqar.fm: متوسط الأسعار المطلوبة لكل حي من العروض
 * المنشورة (district_price_stats، المشتق من vacant_units_public)، فلا يظهر إلا ما هو منشور أصلًا.
 */
export const Route = createFileRoute("/prices/")({
  staticData: { sitemap: true, publicLocale: true },
  loader: async (): Promise<CitySummary[]> => groupByCity(await loadDistrictPrices()),
  head: ({ loaderData, match }) => {
    const locale = localeFromSearch(match.search);
    const title = `${tf(locale, "prices_title")} — ${locale === "en" ? "Jarak" : "جارك"}`;
    const description = tf(locale, "prices_subtitle");
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { property: "og:url", content: "https://jarak-ksa.com/prices" },
      ],
      links: [{ rel: "canonical", href: "https://jarak-ksa.com/prices" }],
      // نفس بيانات الصفحة المنشورة (loaderData) — قاعدة AGENTS.md للبيانات المنظّمة.
      scripts: loaderData?.length
        ? [
            {
              type: "application/ld+json",
              children: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "ItemList",
                name: tf(locale, "prices_title"),
                itemListElement: loaderData.flatMap((c) =>
                  c.districts.map((d, i) => ({
                    "@type": "ListItem",
                    position: i + 1,
                    name: `${d.district} — ${c.city}`,
                    url: `https://jarak-ksa.com${districtPricesPath(c.city, d.district)}`,
                  })),
                ),
              }),
            },
          ]
        : [],
    };
  },
  component: PricesIndex,
});

function PricesIndex() {
  useTrackSiteVisit("/prices");
  const [locale] = useLocale();
  const t = (key: TranslationKey, vars: Record<string, string | number> = {}) =>
    tf(locale, key, vars);
  const cities = Route.useLoaderData();
  const search = langSearch(locale);

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-8 px-5 pt-9 pb-16">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] leading-tight font-bold">{t("prices_title")}</h1>
          <p className="text-[15px] text-muted-foreground">{t("prices_subtitle")}</p>
        </div>

        {cities.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            {t("prices_empty")}
          </p>
        ) : (
          cities.map((c) => (
            <section key={c.city} className="flex flex-col gap-3">
              <h2 className="text-xl font-bold">{t("prices_districts_in", { city: c.city })}</h2>
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-start text-xs text-muted-foreground">
                      <th className="px-4 py-3 text-start font-medium">{t("prices_district")}</th>
                      <th className="px-4 py-3 text-start font-medium">{t("prices_listings")}</th>
                      <th className="px-4 py-3 text-start font-medium">{t("prices_avg_rent")}</th>
                      <th className="px-4 py-3 text-start font-medium">{t("prices_avg_sale")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {c.districts.map((d) => (
                      <tr key={d.district} className="transition-colors hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <Link
                            to="/prices/$city/$district"
                            params={{ city: c.city, district: d.district }}
                            search={search}
                            className="font-semibold underline-offset-4 hover:underline"
                          >
                            {d.district}
                          </Link>
                        </td>
                        <td className="px-4 py-3 tabular-nums">{d.listings}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {d.avgRent != null ? publicSar(d.avgRent, locale) : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {d.avgSale != null ? publicSar(d.avgSale, locale) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}

        <p className="text-xs text-muted-foreground">{t("prices_disclaimer")}</p>
      </main>
    </div>
  );
}
