import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  FileText,
  Gauge,
  MapPin,
  MessageCircle,
  Search,
  SearchX,
  Wallet,
  Wrench,
} from "lucide-react";

import { ListingRow, ListingRowSkeleton } from "@/components/listing-row";
import { SiteHeader, bandPatternStyle } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { translate, useLocale } from "@/lib/i18n";
import {
  defaultFilters,
  filterListings,
  sortListings,
  toListing,
  type Listing,
  type MarketFilters,
  type SortKey,
} from "@/lib/market";
import { PROPERTY_TYPES } from "@/lib/property-types";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "جارك — سوق العروض العقارية" },
      {
        name: "description",
        content:
          "كل العروض تحت سقفٍ واحد: وحدات شاغرة للإيجار من مكاتب ومُلّاك موثوقين، بصور حقيقية وأسعار واضحة، مع التواصل المباشر بالاتصال أو واتساب.",
      },
      { property: "og:title", content: "جارك — سوق العروض العقارية" },
      {
        property: "og:description",
        content: "وحدات شاغرة للإيجار من مكاتب ومُلّاك موثوقين — صور حقيقية وأسعار واضحة.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Market,
});

/** Price ladders differ by an order of magnitude between renting and buying. */
const MAX_RENTS = [20000, 30000, 40000, 60000, 80000, 100000, 150000, 300000];
const MAX_SALE_PRICES = [
  300_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000,
];
const SORT_KEYS = [
  { value: "newest" as const, key: "sort_newest" as const },
  { value: "price-asc" as const, key: "sort_price_asc" as const },
  { value: "price-desc" as const, key: "sort_price_desc" as const },
  { value: "area-desc" as const, key: "sort_area_desc" as const },
];

function useMarketListings() {
  return useQuery({
    queryKey: ["market"],
    staleTime: 60_000,
    queryFn: async (): Promise<Listing[]> => {
      const { data, error } = await supabase.from("vacant_units_public").select("*").limit(500);
      if (error) throw error;
      return (data ?? []).map(toListing).filter((l): l is Listing => l !== null);
    },
  });
}

function Market() {
  useTrackSiteVisit("/");
  const market = useMarketListings();
  const [locale, setLocale] = useLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [filters, setFilters] = useState<MarketFilters>(defaultFilters);
  const resultsRef = useRef<HTMLElement>(null);
  const set = <K extends keyof MarketFilters>(key: K, value: MarketFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const shown = useMemo(
    () => sortListings(filterListings(market.data ?? [], filters), filters.sort),
    [market.data, filters],
  );
  // Offices name their unit types freely («شقة»، «سكني»، «محل»…). Show the ones actually on the
  // market first, then the rest of the catalogue, so nothing a visitor looks for is missing.
  const listedTypes = useMemo(
    () =>
      [...new Set((market.data ?? []).map((l) => l.unitType).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ar"),
      ),
    [market.data],
  );
  const otherTypes = useMemo(
    () => PROPERTY_TYPES.filter((t) => !listedTypes.includes(t)),
    [listedTypes],
  );
  const buying = filters.purpose === "sale";
  const priceLadder = buying ? MAX_SALE_PRICES : MAX_RENTS;
  const counts = useMemo(() => {
    const all = market.data ?? [];
    return {
      rent: all.filter((l) => l.purpose === "rent").length,
      sale: all.filter((l) => l.purpose === "sale").length,
    };
  }, [market.data]);
  const filtered =
    filters.text.trim() !== "" ||
    filters.purpose !== "all" ||
    filters.unitType !== "" ||
    filters.minRooms > 0 ||
    filters.furnished !== "all" ||
    filters.maxPrice !== null;

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader locale={locale} onLocaleChange={setLocale} />

      <section className="bg-sidebar text-sidebar-foreground" style={bandPatternStyle}>
        <div className="mx-auto max-w-6xl px-4 pt-10 pb-8 md:pt-14">
          <h1 className="max-w-3xl text-3xl leading-tight font-extrabold md:text-5xl">
            {t("hero_title")}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-sidebar-foreground/80 md:text-lg">
            {t("hero_subtitle")}
          </p>

          <form
            className="mt-6 rounded-xl bg-card p-3 text-card-foreground shadow-lg md:p-4"
            onSubmit={(e) => {
              e.preventDefault();
              resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            role="search"
            aria-label={locale === "en" ? "Search listings" : "البحث في العروض"}
          >
            <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  { value: "all", label: t("tab_all"), n: counts.rent + counts.sale },
                  { value: "rent", label: t("tab_rent"), n: counts.rent },
                  { value: "sale", label: t("tab_sale"), n: counts.sale },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={filters.purpose === tab.value}
                  onClick={() => {
                    set("purpose", tab.value);
                    // The two ladders share no values, so a ceiling picked for rent is meaningless
                    // once the visitor switches to buying.
                    set("maxPrice", null);
                  }}
                  className={cn(
                    "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                    filters.purpose === tab.value
                      ? "bg-card text-card-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {tab.n > 0 ? (
                    <span className="ms-1.5 text-xs font-normal opacity-70">({tab.n})</span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <div className="relative flex-1">
                <MapPin
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-primary"
                  aria-hidden
                />
                <Input
                  className="h-11 ps-9"
                  placeholder={t("search_placeholder")}
                  value={filters.text}
                  onChange={(e) => set("text", e.target.value)}
                  aria-label={t("search_aria")}
                />
              </div>
              <Button type="submit" size="lg" className="h-11 md:w-40">
                <Search className="size-4" />
                {t("search_button")}
              </Button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              <Select
                value={filters.unitType || "all"}
                onValueChange={(v) => set("unitType", v === "all" ? "" : v)}
              >
                <SelectTrigger aria-label={t("filter_type")}>
                  <SelectValue placeholder={t("filter_type")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter_type_all")}</SelectItem>
                  {listedTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                  {otherTypes.length > 0 && listedTypes.length > 0 ? (
                    <div className="my-1 border-t border-border" />
                  ) : null}
                  {otherTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={String(filters.minRooms)}
                onValueChange={(v) => set("minRooms", Number(v))}
              >
                <SelectTrigger aria-label={t("filter_rooms")}>
                  <SelectValue placeholder={t("filter_rooms")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{t("filter_rooms_any")}</SelectItem>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}+
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.furnished}
                onValueChange={(v) => set("furnished", v as MarketFilters["furnished"])}
              >
                <SelectTrigger aria-label={t("filter_furnished")}>
                  <SelectValue placeholder={t("filter_furnished")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter_furnished_all")}</SelectItem>
                  <SelectItem value="yes">{t("filter_furnished_yes")}</SelectItem>
                  <SelectItem value="no">{t("filter_furnished_no")}</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.maxPrice === null ? "all" : String(filters.maxPrice)}
                onValueChange={(v) => set("maxPrice", v === "all" ? null : Number(v))}
              >
                <SelectTrigger
                  aria-label={buying ? t("filter_price_sale") : t("filter_price_rent")}
                >
                  <SelectValue
                    placeholder={buying ? t("filter_price_sale") : t("filter_price_rent")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filter_price_any")}</SelectItem>
                  {priceLadder.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {locale === "en" ? "up to " : "حتى "}
                      {r.toLocaleString(locale === "en" ? "en-US" : "ar-SA")}
                      {locale === "en" ? " SAR" : " ر.س"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.sort} onValueChange={(v) => set("sort", v as SortKey)}>
                <SelectTrigger aria-label={t("filter_sort")} className="col-span-2 md:col-span-1">
                  <SelectValue placeholder={t("filter_sort")} />
                </SelectTrigger>
                <SelectContent>
                  {SORT_KEYS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>
        </div>
      </section>

      <main ref={resultsRef} className="mx-auto max-w-6xl scroll-mt-4 px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold md:text-2xl">{t("results_heading")}</h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {market.data ? (
              <span>
                {shown.length.toLocaleString(locale === "en" ? "en-US" : "ar-SA")}
                {filtered
                  ? ` / ${market.data.length.toLocaleString(locale === "en" ? "en-US" : "ar-SA")}`
                  : locale === "en"
                    ? " listings"
                    : " عرض"}
              </span>
            ) : null}
            {filtered ? (
              <Button size="sm" variant="ghost" onClick={() => setFilters(defaultFilters)}>
                {t("results_clear")}
              </Button>
            ) : null}
          </div>
        </div>

        {market.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <ListingRowSkeleton />
            <ListingRowSkeleton />
            <ListingRowSkeleton />
          </div>
        ) : market.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="font-medium">{t("results_error_title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("results_error_body")}</p>
            <Button className="mt-3" variant="outline" onClick={() => market.refetch()}>
              {t("results_retry")}
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
            <SearchX className="size-10 opacity-50" aria-hidden />
            <p className="font-medium text-foreground">
              {filtered ? t("results_empty_filtered") : t("results_empty_all")}
            </p>
            <p className="text-sm">
              {filtered ? t("results_empty_filtered_hint") : t("results_empty_all_hint")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((l) => (
              <ListingRow key={l.id} listing={l} />
            ))}
          </div>
        )}
      </main>

      <OfficesSection />

      <footer className="border-t border-border bg-card/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-sm text-muted-foreground">
          <span>
            {t("footer_tagline")}
            {locale === "ar" ? " · فواتير متوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك" : ""}
          </span>
          <span className="flex gap-4">
            <Link to="/legal/$slug" params={{ slug: "terms" }} className="hover:underline">
              {locale === "ar" ? "الشروط والأحكام" : "Terms"}
            </Link>
            <Link to="/legal/$slug" params={{ slug: "privacy" }} className="hover:underline">
              {locale === "ar" ? "سياسة الخصوصية" : "Privacy"}
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    icon: Building2,
    title: "الأملاك والوحدات",
    body: "كل عقار ووحداته، حالة الإشغال، ورقم عداد الكهرباء والمياه مع قراءاته الدورية.",
  },
  {
    icon: FileText,
    title: "العقود والتوافق مع إيجار",
    body: "مدة العقد والإيجار وجدول الدفعات، مع رقم عقد «إيجار» وحالة التوثيق.",
  },
  {
    icon: Wallet,
    title: "التحصيل والمحاسبة",
    body: "دفعات، متأخرات، مصروفات، وكشف حساب المالك — وفواتير إلكترونية بمتطلبات ZATCA.",
  },
  {
    icon: Wrench,
    title: "الصيانة",
    body: "طلب المستأجر يصبح مهمة مُسندة لفني، والتكلفة تُرحّل للمصروفات تلقائيًا.",
  },
  {
    icon: Gauge,
    title: "لوحة المؤشرات",
    body: "الإشغال والشواغر، المحصّل مقابل المستحق، الصيانة المفتوحة، والعقود المنتهية قريبًا.",
  },
  {
    icon: MessageCircle,
    title: "مساعد واتساب الذكي",
    body: "يفهم رسالة المستأجر بالعربي ويحوّلها إلى إجراء داخل النظام مع رد مناسب.",
  },
];

/** For office owners: what the platform does, and how to publish offers here. */
function OfficesSection() {
  return (
    <section id="features" className="border-t border-border bg-card/50">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <p className="font-medium text-brass">لأصحاب المكاتب العقارية</p>
        <h2 className="mt-2 max-w-2xl font-display text-2xl font-bold md:text-3xl">
          انشر عروضك هنا، وأدر أملاكك في نظام واحد
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          سجّل وحداتك بالصور، وابنِ صفحة لمكتبك ولكل مالك، وتظهر عروضك للجميع في هذه الصفحة — مع
          إدارة العقود والتحصيل والصيانة والفوترة الإلكترونية.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/register-office">
              سجّل مكتبك
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/offices">تصفّح مكاتب الحي</Link>
          </Button>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.title}
              className="rounded-lg border border-border bg-card p-6 shadow-deed"
            >
              <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-foreground">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
