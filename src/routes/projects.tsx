import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { tf } from "@/components/listing-detail/format";
import { ProjectCard } from "@/components/project-card";
import { SiteHeader } from "@/components/site-header";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { publicCount, publicSar } from "@/lib/format";
import { localeFromSearch, useLocale, type TranslationKey } from "@/lib/i18n";
import {
  defaultProjectFilters,
  filterProjects,
  projectCities,
  PROJECT_STATUSES,
  sortProjects,
  statusLabel,
  toProject,
  type Project,
  type ProjectFilters,
} from "@/lib/projects";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";

/** سقوف «يبدأ من» في الفلتر — أسعار مشاريع لا إيجارات، فالسلّم بالملايين. */
const PRICE_CAPS = [500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000];

const SORTS: { value: ProjectFilters["sort"]; key: TranslationKey }[] = [
  { value: "newest", key: "pj_sort_newest" },
  { value: "price-asc", key: "pj_sort_price_asc" },
  { value: "price-desc", key: "pj_sort_price_desc" },
  { value: "completion-desc", key: "pj_sort_completion" },
];

async function loadProjects(): Promise<Project[]> {
  const { data, error } = await supabase.from("projects_public").select("*").limit(500);
  if (error) throw error;
  return (data ?? []).map(toProject).filter((p): p is Project => p !== null);
}

export const Route = createFileRoute("/projects")({
  staticData: { sitemap: true, publicLocale: true },
  loader: loadProjects,
  head: ({ loaderData, match }) => {
    const locale = localeFromSearch(match.search);
    const title = `${tf(locale, "pj_title")} — ${locale === "en" ? "Jarak" : "جارك"}`;
    const description = tf(locale, "pj_subtitle");
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { property: "og:url", content: "https://jarak-ksa.com/projects" },
      ],
      links: [{ rel: "canonical", href: "https://jarak-ksa.com/projects" }],
      // نفس بيانات الصفحة المنشورة (loaderData) — قاعدة AGENTS.md للبيانات المنظّمة.
      scripts: loaderData?.length
        ? [
            {
              type: "application/ld+json",
              children: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "ItemList",
                name: tf(locale, "pj_title"),
                itemListElement: loaderData.map((p, i) => ({
                  "@type": "ListItem",
                  position: i + 1,
                  name: p.name,
                  url: `https://jarak-ksa.com/project/${encodeURIComponent(p.id)}`,
                })),
              }),
            },
          ]
        : [],
    };
  },
  component: Projects,
});

function Projects() {
  useTrackSiteVisit("/projects");
  const [locale] = useLocale();
  const t = (key: TranslationKey) => tf(locale, key);
  const all = Route.useLoaderData();
  const [filters, setFilters] = useState<ProjectFilters>(defaultProjectFilters);
  const set = <K extends keyof ProjectFilters>(key: K, value: ProjectFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const cities = useMemo(() => projectCities(all), [all]);
  const rows = useMemo(
    () => sortProjects(filterProjects(all, filters), filters.sort),
    [all, filters],
  );

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-5 pt-9 pb-16">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] leading-tight font-bold">{t("pj_title")}</h1>
          <p className="text-[15px] text-muted-foreground">{t("pj_subtitle")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filters.text}
              onChange={(e) => set("text", e.target.value)}
              placeholder={t("pj_search")}
              aria-label={t("pj_search")}
              className="h-10 ps-9"
            />
          </div>

          <Select
            value={filters.city || "all"}
            onValueChange={(v) => set("city", v === "all" ? "" : v)}
          >
            <SelectTrigger aria-label={t("prices_city")} className="h-10 w-auto min-w-[130px]">
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

          <Select
            value={filters.status}
            onValueChange={(v) => set("status", v as ProjectFilters["status"])}
          >
            <SelectTrigger aria-label={t("pj_status_all")} className="h-10 w-auto min-w-[140px]">
              <SelectValue placeholder={t("pj_status_all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("pj_status_all")}</SelectItem>
              {PROJECT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel(s, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.maxPriceFrom === null ? "all" : String(filters.maxPriceFrom)}
            onValueChange={(v) => set("maxPriceFrom", v === "all" ? null : Number(v))}
          >
            <SelectTrigger aria-label={t("pj_price_any")} className="h-10 w-auto min-w-[140px]">
              <SelectValue placeholder={t("pj_price_any")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("pj_price_any")}</SelectItem>
              {PRICE_CAPS.map((c) => (
                <SelectItem key={c} value={String(c)}>
                  {`≤ ${publicSar(c, locale)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.sort}
            onValueChange={(v) => set("sort", v as ProjectFilters["sort"])}
          >
            <SelectTrigger aria-label={t("filter_sort")} className="h-10 w-auto min-w-[130px]">
              <SelectValue placeholder={t("filter_sort")} />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {t(s.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-sm text-muted-foreground tabular-nums">
          {/* publicCount يصرّف الاسم: «مشروع واحد» و«3 مشاريع» و«1 project» — لا «1 projects». */}
          {publicCount(
            rows.length,
            locale,
            { one: "مشروع واحد", two: "مشروعان", few: "مشاريع", many: "مشروعًا" },
            { one: "project", many: "projects" },
          )}
        </p>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-5 py-12 text-center text-sm text-muted-foreground">
            {all.length === 0 ? t("pj_empty") : t("pj_empty_filtered")}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => (
              <ProjectCard key={p.id} project={p} locale={locale} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
