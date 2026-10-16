import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Heart, List, LocateFixed, Map as MapIcon, Search, X } from "lucide-react";

import { DemoRequestDialog } from "@/components/demo-request-dialog";
import { JarakSymbol } from "@/components/jarak-logo";
import { MarketCard, MarketCardSkeleton } from "@/components/market-card";
import type { MapBounds } from "@/components/market-map";
import { SiteHeader } from "@/components/site-header";
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
import { useFavorites } from "@/lib/favorites";
import { translate, useLocale, type Locale } from "@/lib/i18n";
import { distanceMeters } from "@/lib/map-markers";
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

const MarketMap = lazy(() => import("@/components/market-map"));

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
      { property: "og:url", content: "https://jarak-ksa.com/" },
    ],
    links: [{ rel: "canonical", href: "https://jarak-ksa.com/" }],
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
/** Search radii in km; 0 = no limit. */
const RADII = [1, 3, 5, 10, 0];

type Origin = {
  lat: number;
  lng: number;
  /** null = the visitor's own position */ label: string | null;
};
type Row = { l: Listing; d: number | null };

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

/** Districts that have located offers, centred on their offers — the "pick a district" choices. */
function districtCentres(all: Listing[]) {
  const by = new Map<string, { lat: number; lng: number; n: number }>();
  for (const l of all) {
    if (!l.district || l.lat == null || l.lng == null) continue;
    const c = by.get(l.district) ?? { lat: 0, lng: 0, n: 0 };
    by.set(l.district, { lat: c.lat + l.lat, lng: c.lng + l.lng, n: c.n + 1 });
  }
  return [...by.entries()]
    .map(([name, c]) => ({ name, lat: c.lat / c.n, lng: c.lng / c.n, n: c.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 12);
}

function inBounds(l: Listing, b: MapBounds) {
  return (
    l.lat != null &&
    l.lng != null &&
    l.lat >= b.south &&
    l.lat <= b.north &&
    l.lng >= b.west &&
    l.lng <= b.east
  );
}

function Market() {
  useTrackSiteVisit("/");
  const market = useMarketListings();
  const [locale, setLocale] = useLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const km = (r: number) => `${r} ${t("unit_km")}`;

  const [filters, setFilters] = useState<MarketFilters>(defaultFilters);
  const set = <K extends keyof MarketFilters>(key: K, value: MarketFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [radius, setRadius] = useState(3);
  const [byNearest, setByNearest] = useState(false);
  const [area, setArea] = useState<MapBounds | null>(null);
  const [locating, setLocating] = useState(false);
  const [locDenied, setLocDenied] = useState(false);
  const [prompt, setPrompt] = useState(true);
  const [manual, setManual] = useState(false);
  const [moved, setMoved] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const fav = useFavorites();
  const [mounted, setMounted] = useState(false);
  const boundsRef = useRef<MapBounds | null>(null);
  useEffect(() => setMounted(true), []);

  const all = market.data;
  const rows = useMemo((): Row[] => {
    let out: Row[] = filterListings(all ?? [], filters).map((l) => ({
      l,
      d:
        origin && l.lat != null && l.lng != null
          ? distanceMeters(origin, { lat: l.lat, lng: l.lng }) / 1000
          : null,
    }));
    // A searched map area replaces the radius (both together would mean two different places).
    if (origin && radius > 0 && !area) out = out.filter((r) => r.d != null && r.d <= radius);
    if (area) out = out.filter((r) => inBounds(r.l, area));
    if (savedOnly) out = out.filter((r) => fav.ids.has(r.l.id));
    if (origin && byNearest) {
      return out.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    }
    const dist = new Map(out.map((r) => [r.l.id, r.d]));
    return sortListings(
      out.map((r) => r.l),
      filters.sort,
    ).map((l) => ({ l, d: dist.get(l.id) ?? null }));
  }, [all, filters, origin, radius, area, byNearest, savedOnly, fav.ids]);
  const shownListings = useMemo(() => rows.map((r) => r.l), [rows]);

  // Offices name their unit types freely («شقة»، «سكني»، «محل»…). Show the ones actually on the
  // market first, then the rest of the catalogue, so nothing a visitor looks for is missing.
  const listedTypes = useMemo(
    () =>
      [...new Set((all ?? []).map((l) => l.unitType).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "ar"),
      ),
    [all],
  );
  const otherTypes = useMemo(
    () => PROPERTY_TYPES.filter((t) => !listedTypes.includes(t)),
    [listedTypes],
  );
  const districts = useMemo(() => districtCentres(all ?? []), [all]);
  const hasLocated = districts.length > 0;
  const counts = useMemo(
    () => ({
      rent: (all ?? []).filter((l) => l.purpose === "rent").length,
      sale: (all ?? []).filter((l) => l.purpose === "sale").length,
    }),
    [all],
  );
  const buying = filters.purpose === "sale";
  const priceLadder = buying ? MAX_SALE_PRICES : MAX_RENTS;
  const anyFilter =
    filters.text.trim() !== "" ||
    filters.purpose !== "all" ||
    filters.unitType !== "" ||
    filters.minRooms > 0 ||
    filters.furnished !== "all" ||
    filters.maxPrice !== null ||
    area !== null ||
    savedOnly;

  function applyOrigin(o: Origin) {
    setOrigin(o);
    setRadius((r) => r || 3);
    setByNearest(true);
    setArea(null);
    setMoved(false);
    setPrompt(false);
    setManual(false);
    setSheetOpen(true);
  }

  function askNear() {
    if (origin) {
      // Second press turns "near me" off again.
      setOrigin(null);
      setByNearest(false);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocDenied(true);
      setManual(true);
      setSheetOpen(false);
      return;
    }
    setLocating(true);
    setPrompt(false);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        applyOrigin({ lat: p.coords.latitude, lng: p.coords.longitude, label: null });
      },
      () => {
        setLocating(false);
        setLocDenied(true);
        setManual(true);
        setSheetOpen(false);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  }

  function resetFilters() {
    setFilters(defaultFilters);
    setSavedOnly(false);
    setArea(null);
    setMoved(false);
  }

  function select(id: string) {
    setSelId(id);
    setSheetOpen(true);
    // Let the sheet open before scrolling its list.
    setTimeout(
      () =>
        document
          .getElementById(`card-${id}`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      60,
    );
  }

  const place = origin ? (origin.label ?? t("my_location")) : "";
  const note = area
    ? t("results_area")
    : origin
      ? (radius > 0 ? t("results_within").replace("{r}", km(radius)) : t("results_from")).replace(
          "{place}",
          place,
        )
      : t("results_all_note");
  const nextRadius = RADII[RADII.indexOf(radius) + 1];
  const fitKey = `${origin?.lat ?? ""},${origin?.lng ?? ""},${radius}|${all ? "ready" : "loading"}`;

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader locale={locale} onLocaleChange={setLocale} />
      <h1 className="sr-only">{t("hero_title")}</h1>

      <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] flex-col">
        {/* Phones: search gets its own full-width row — inside the swipeable filter row below it
            would start off-screen. */}
        <div className="relative z-10 shrink-0 bg-card px-4 pt-2.5 sm:hidden">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-10 ps-9 text-base"
              placeholder={t("search_placeholder")}
              value={filters.text}
              onChange={(e) => set("text", e.target.value)}
              aria-label={t("search_aria")}
            />
          </div>
        </div>
        {/* Filter bar */}
        <div
          role="search"
          aria-label={locale === "en" ? "Search listings" : "البحث في العروض"}
          className="relative z-10 flex shrink-0 items-center gap-2.5 overflow-x-auto border-b border-border bg-card px-4 py-2.5"
        >
          <div className="flex shrink-0 shadow-[inset_0_0_0_1.5px_var(--color-foreground)]">
            {(
              [
                { value: "all", label: t("tab_all"), n: counts.rent + counts.sale },
                { value: "rent", label: t("tab_rent"), n: counts.rent },
                { value: "sale", label: t("tab_sale"), n: counts.sale },
              ] as const
            ).map((tab) => {
              const on = filters.purpose === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    // The two ladders share no values, so a ceiling picked for rent is meaningless
                    // once the visitor switches to buying.
                    setFilters((f) => ({ ...f, purpose: tab.value, maxPrice: null }));
                  }}
                  className={cn(
                    "flex h-10 items-center gap-[7px] px-3.5 text-[15px] font-semibold whitespace-nowrap transition-colors",
                    on ? "bg-foreground text-background" : "hover:bg-muted",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "text-xs font-medium tabular-nums",
                      on ? "text-background/70" : "text-muted-foreground",
                    )}
                  >
                    {tab.n.toLocaleString("en-US")}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={askNear}
            aria-pressed={Boolean(origin)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 border-[1.5px] border-foreground px-3.5 text-[15px] font-semibold whitespace-nowrap transition-colors",
              origin ? "bg-foreground text-background" : "bg-card hover:bg-muted",
            )}
          >
            <LocateFixed
              className={cn("size-[18px]", origin ? "text-[#FF6B50]" : "text-primary")}
              aria-hidden
            />
            {locating ? t("near_locating") : origin ? t("near_active") : t("near_me")}
          </button>

          {origin ? (
            <div className="flex shrink-0 gap-1.5" role="group" aria-label={t("radius_label")}>
              {RADII.map((r) => {
                const on = radius === r;
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setRadius(r);
                      setArea(null);
                    }}
                    className={cn(
                      "flex h-10 items-center gap-1.5 bg-card px-3 text-sm font-semibold whitespace-nowrap tabular-nums",
                      on
                        ? "text-red-text shadow-[inset_0_0_0_2px_var(--color-primary)]"
                        : "shadow-[inset_0_0_0_1px_var(--color-input)] hover:bg-muted",
                    )}
                  >
                    {on ? <span className="size-[7px] bg-primary" aria-hidden /> : null}
                    {r ? km(r) : t("radius_none")}
                  </button>
                );
              })}
            </div>
          ) : null}

          <span className="hidden h-7 w-px shrink-0 bg-border sm:block" aria-hidden />

          <div className="relative hidden w-52 shrink-0 sm:block">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="h-10 ps-9 text-sm md:text-sm"
              placeholder={t("search_placeholder")}
              value={filters.text}
              onChange={(e) => set("text", e.target.value)}
              aria-label={t("search_aria")}
            />
          </div>

          <Select
            value={filters.unitType || "all"}
            onValueChange={(v) => set("unitType", v === "all" ? "" : v)}
          >
            <SelectTrigger
              aria-label={t("filter_type")}
              className="h-10 w-auto shrink-0 gap-2 text-sm"
            >
              <SelectValue placeholder={t("filter_type")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter_type_all")}</SelectItem>
              {listedTypes.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {ty}
                </SelectItem>
              ))}
              {otherTypes.length > 0 && listedTypes.length > 0 ? (
                <div className="my-1 border-t border-border" />
              ) : null}
              {otherTypes.map((ty) => (
                <SelectItem key={ty} value={ty}>
                  {ty}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(filters.minRooms)}
            onValueChange={(v) => set("minRooms", Number(v))}
          >
            <SelectTrigger
              aria-label={t("filter_rooms")}
              className="h-10 w-auto shrink-0 gap-2 text-sm"
            >
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
            value={filters.maxPrice === null ? "all" : String(filters.maxPrice)}
            onValueChange={(v) => set("maxPrice", v === "all" ? null : Number(v))}
          >
            <SelectTrigger
              aria-label={buying ? t("filter_price_sale") : t("filter_price_rent")}
              className="h-10 w-auto shrink-0 gap-2 text-sm"
            >
              <SelectValue placeholder={buying ? t("filter_price_sale") : t("filter_price_rent")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filter_price_any")}</SelectItem>
              {priceLadder.map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {locale === "en" ? "up to " : "حتى "}
                  {r.toLocaleString("en-US")}
                  {locale === "en" ? " SAR" : " ر.س"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            type="button"
            aria-pressed={filters.furnished === "yes"}
            onClick={() => set("furnished", filters.furnished === "yes" ? "all" : "yes")}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap",
              filters.furnished === "yes"
                ? "bg-foreground text-background"
                : "bg-card shadow-[inset_0_0_0_1px_var(--color-input)] hover:bg-muted",
            )}
          >
            <span className="grid size-4 place-items-center shadow-[inset_0_0_0_1.5px_currentColor]">
              {filters.furnished === "yes" ? <Check className="size-3" aria-hidden /> : null}
            </span>
            {t("filter_furnished_yes")}
          </button>

          <button
            type="button"
            aria-pressed={savedOnly}
            onClick={() => setSavedOnly((v) => !v)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap",
              savedOnly
                ? "bg-foreground text-background"
                : "bg-card shadow-[inset_0_0_0_1px_var(--color-input)] hover:bg-muted",
            )}
          >
            <Heart
              className={cn("size-4", savedOnly ? "fill-[#FF6B50] text-[#FF6B50]" : "text-primary")}
              aria-hidden
            />
            {t("fav_filter")}
            {fav.ids.size > 0 ? (
              <span
                className={cn(
                  "text-xs tabular-nums",
                  savedOnly ? "text-background/70" : "text-muted-foreground",
                )}
              >
                {fav.ids.size}
              </span>
            ) : null}
          </button>

          {anyFilter ? (
            <button
              type="button"
              onClick={resetFilters}
              className="shrink-0 px-1 text-sm font-semibold whitespace-nowrap underline underline-offset-4 hover:text-red-text"
            >
              {t("results_clear")}
            </button>
          ) : null}
        </div>

        {/* List + map. Desktop: side by side (list at the reading start). Mobile: the map fills the
            space and the list is a bottom sheet over it. */}
        <div className="relative isolate min-h-0 flex-1 lg:grid lg:grid-cols-[440px_minmax(0,1fr)]">
          <section
            aria-label={t("results_heading")}
            className={cn(
              "absolute inset-x-0 bottom-0 z-[800] flex min-h-0 flex-col bg-background shadow-[0_-8px_24px_rgba(32,30,29,.16)] transition-[height] duration-200 lg:static lg:h-auto lg:border-e lg:border-border lg:shadow-none",
              sheetOpen ? "h-[calc(100%-56px)]" : "h-[42%]",
            )}
          >
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              aria-label={sheetOpen ? t("view_map") : t("view_list")}
              className="flex h-[26px] shrink-0 items-center justify-center bg-card lg:hidden"
            >
              <span className="h-1 w-11 bg-input" />
            </button>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 pt-3.5 pb-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="text-[17px] leading-snug font-bold">
                  {market.data
                    ? t("results_count").replace("{n}", rows.length.toLocaleString("en-US"))
                    : t("results_heading")}
                </h2>
                <span className="truncate text-[13px] text-muted-foreground">{note}</span>
              </div>
              <Select
                value={origin && byNearest ? "nearest" : filters.sort}
                onValueChange={(v) => {
                  if (v === "nearest") setByNearest(true);
                  else {
                    setByNearest(false);
                    set("sort", v as SortKey);
                  }
                }}
              >
                <SelectTrigger
                  aria-label={t("filter_sort")}
                  className="h-9 w-auto shrink-0 gap-2 text-[13px] font-semibold"
                >
                  <SelectValue placeholder={t("filter_sort")} />
                </SelectTrigger>
                <SelectContent>
                  {origin ? <SelectItem value="nearest">{t("sort_nearest")}</SelectItem> : null}
                  {SORT_KEYS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
              {market.isLoading ? (
                <>
                  <MarketCardSkeleton />
                  <MarketCardSkeleton />
                  <MarketCardSkeleton />
                </>
              ) : market.isError ? (
                <EmptyState
                  title={t("results_error_title")}
                  hint={t("results_error_body")}
                  actions={
                    <Button variant="outline" onClick={() => market.refetch()}>
                      {t("results_retry")}
                    </Button>
                  }
                />
              ) : rows.length === 0 && savedOnly ? (
                <EmptyState
                  title={t("fav_empty")}
                  hint={
                    fav.signedIn
                      ? t("fav_empty_hint")
                      : `${t("fav_empty_hint")} ${t("fav_local_note")}`
                  }
                  actions={
                    <Button variant="outline" onClick={() => setSavedOnly(false)}>
                      {t("tab_all")}
                    </Button>
                  }
                />
              ) : rows.length === 0 ? (
                <EmptyState
                  title={
                    origin && radius > 0 && !area
                      ? t("results_empty_near").replace("{r}", km(radius))
                      : anyFilter
                        ? t("results_empty_filtered")
                        : t("results_empty_all")
                  }
                  hint={
                    origin || anyFilter ? t("results_empty_near_hint") : t("results_empty_all_hint")
                  }
                  actions={
                    origin || anyFilter ? (
                      <>
                        {origin && radius > 0 && !area && nextRadius !== undefined ? (
                          <Button variant="secondary" onClick={() => setRadius(nextRadius)}>
                            {t("results_widen").replace(
                              "{r}",
                              nextRadius ? km(nextRadius) : t("radius_none"),
                            )}
                          </Button>
                        ) : null}
                        {anyFilter ? (
                          <Button variant="outline" onClick={resetFilters}>
                            {t("results_clear")}
                          </Button>
                        ) : null}
                      </>
                    ) : null
                  }
                />
              ) : (
                rows.map((r) => (
                  <MarketCard
                    key={r.l.id}
                    listing={r.l}
                    distanceKm={r.d}
                    hot={r.l.id === (hoverId ?? selId)}
                    locale={locale}
                    onHover={setHoverId}
                    saved={fav.ids.has(r.l.id)}
                    onToggleSave={fav.toggle}
                  />
                ))
              )}
            </div>
          </section>

          <div className="absolute inset-0 min-h-0 bg-[#ECEAE6] lg:relative lg:inset-auto">
            {mounted ? (
              <Suspense fallback={null}>
                <MarketMap
                  listings={shownListings}
                  hotId={hoverId ?? selId}
                  origin={origin}
                  radiusKm={radius}
                  fitKey={fitKey}
                  onHover={setHoverId}
                  onSelect={select}
                  onUserMove={() => setMoved(true)}
                  onSpot={(b) => {
                    setArea(b);
                    setMoved(false);
                    setSheetOpen(true);
                  }}
                  boundsRef={boundsRef}
                />
              </Suspense>
            ) : null}

            {moved ? (
              <button
                type="button"
                onClick={() => {
                  setArea(boundsRef.current);
                  setMoved(false);
                }}
                className="absolute top-3.5 left-1/2 z-[500] flex h-[42px] -translate-x-1/2 items-center gap-2 bg-card px-4 text-sm font-semibold whitespace-nowrap shadow-[0_4px_14px_rgba(32,30,29,.2)]"
              >
                <Search className="size-4" aria-hidden />
                {t("map_search_area")}
              </button>
            ) : null}

            {locating ? (
              <div className="absolute top-3.5 left-1/2 z-[500] flex h-11 -translate-x-1/2 items-center gap-2.5 bg-foreground px-4 text-sm font-medium whitespace-nowrap text-background shadow-e2">
                <span
                  className="size-4 animate-spin border-2 border-background/30 border-t-background"
                  aria-hidden
                />
                {t("near_locating")}
              </div>
            ) : null}

            {prompt && !origin && !manual && !locating && hasLocated ? (
              <NearPrompt
                locale={locale}
                onNear={askNear}
                onManual={() => {
                  setPrompt(false);
                  setManual(true);
                  setSheetOpen(false);
                }}
                onClose={() => setPrompt(false)}
              />
            ) : null}

            {manual ? (
              <ManualPicker
                locale={locale}
                denied={locDenied}
                districts={districts}
                onPick={(d) => applyOrigin({ lat: d.lat, lng: d.lng, label: d.name })}
                onClose={() => setManual(false)}
              />
            ) : null}

            <div
              className={cn(
                "absolute start-3 z-[500] flex gap-3 bg-card px-2.5 py-2 text-xs font-medium shadow-[0_2px_8px_rgba(32,30,29,.12)] lg:bottom-8",
                sheetOpen ? "hidden lg:flex" : "bottom-[calc(42%+68px)]",
              )}
            >
              <span className="flex items-center gap-[5px]">
                <span className="size-3 bg-foreground" aria-hidden />
                {t("map_legend_rent")}
              </span>
              <span className="flex items-center gap-[5px]">
                <span
                  className="size-3 bg-card shadow-[inset_0_0_0_2px_var(--color-foreground)]"
                  aria-hidden
                />
                {t("map_legend_sale")}
              </span>
              <span className="flex items-center gap-[5px]">
                <span className="size-3 bg-primary" aria-hidden />
                {t("map_legend_selected")}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            className={cn(
              "absolute left-1/2 z-[850] flex h-11 -translate-x-1/2 items-center gap-2 bg-foreground px-[18px] text-[15px] font-semibold text-background shadow-[0_8px_20px_rgba(32,30,29,.3)] lg:hidden",
              sheetOpen ? "bottom-4" : "bottom-[calc(42%+12px)]",
            )}
          >
            {sheetOpen ? (
              <MapIcon className="size-[18px]" aria-hidden />
            ) : (
              <List className="size-[18px]" aria-hidden />
            )}
            {sheetOpen ? t("view_map") : t("view_list")}
          </button>
        </div>
      </div>

      <ForOffices />

      <footer className="border-t border-border bg-card py-8">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-2 px-5 text-sm text-muted-foreground">
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

/** Empty / error state: two small outlined arches (the logo's two homes), a title, a hint. */
function EmptyState({
  title,
  hint,
  actions,
}: {
  title: string;
  hint: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 bg-card px-6 py-9 text-center shadow-[inset_0_0_0_1px_var(--color-border)]">
      <div className="flex items-end gap-[5px]" aria-hidden>
        <span className="h-[50px] w-8 rounded-arch shadow-[inset_0_0_0_2px_var(--color-input)]" />
        <span className="h-9 w-8 rounded-arch shadow-[inset_0_0_0_2px_var(--color-input)]" />
      </div>
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{hint}</p>
      {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** First-visit card on the map: offer to sort by distance. */
function NearPrompt({
  locale,
  onNear,
  onManual,
  onClose,
}: {
  locale: Locale;
  onNear: () => void;
  onManual: () => void;
  onClose: () => void;
}) {
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  return (
    <div className="absolute start-3.5 top-3.5 z-[500] flex w-[min(340px,calc(100%-28px))] flex-col gap-3 bg-foreground p-[18px] text-background shadow-e2">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full shadow-[inset_0_0_0_2px_#FF6B50]">
          <LocateFixed className="size-5 text-[#FF6B50]" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-base font-bold">{t("near_prompt_title")}</span>
          <span className="text-[13px] leading-relaxed text-background/70">
            {t("near_prompt_body")}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("near_close")}
          className="-m-1 grid size-8 shrink-0 place-items-center text-background/70 hover:text-background"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <Button className="h-11 flex-1 justify-center" onClick={onNear}>
          {t("near_me")}
        </Button>
        <button
          type="button"
          onClick={onManual}
          className="h-11 flex-1 border-[1.5px] border-muted-foreground text-[15px] font-semibold transition-colors hover:bg-background/10"
        >
          {t("near_pick_district")}
        </button>
      </div>
    </div>
  );
}

/** Pick a district instead of sharing the location (or after the browser refused it). */
function ManualPicker({
  locale,
  denied,
  districts,
  onPick,
  onClose,
}: {
  locale: Locale;
  denied: boolean;
  districts: { name: string; lat: number; lng: number }[];
  onPick: (d: { name: string; lat: number; lng: number }) => void;
  onClose: () => void;
}) {
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  return (
    <div className="absolute start-3.5 top-3.5 z-[510] flex w-[min(380px,calc(100%-28px))] flex-col gap-3 bg-card p-[18px] shadow-e2">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex flex-col gap-1">
          <span className="text-base font-bold">{t("near_manual_title")}</span>
          <span className="text-[13px] leading-relaxed text-muted-foreground">
            {denied ? t("near_manual_denied") : t("near_manual_body")}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("near_close")}
          className="grid size-8 shrink-0 place-items-center"
        >
          <X className="size-[18px]" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {districts.map((d) => (
          <button
            key={d.name}
            type="button"
            onClick={() => onPick(d)}
            className="flex h-[38px] items-center bg-card px-3 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-input)] hover:shadow-[inset_0_0_0_2px_var(--color-foreground)]"
          >
            {d.name}
          </button>
        ))}
      </div>
    </div>
  );
}

const PILLARS = [
  {
    n: "01",
    title: "الوحدات والعقود",
    body: "سجّل كل وحدة بصورها وعدّاداتها، واربطها بعقد إيجار وجدول دفعات وتجديد بنقرة.",
  },
  {
    n: "02",
    title: "التحصيل والفواتير",
    body: "تذكيرات تلقائية قبل الاستحقاق، وفواتير إلكترونية متوافقة مع هيئة الزكاة والضريبة.",
  },
  {
    n: "03",
    title: "الصيانة الذكية",
    body: "فرز الطلبات العاجلة تلقائياً، وجدولة الفني الأقل انشغالاً، وموافقة المالك عند تجاوز الحد.",
  },
  {
    n: "04",
    title: "بوابات المالك والمستأجر",
    body: "المالك يرى دخله ويوافق، والمستأجر يدفع ويطلب الصيانة ويجدد، دون رسائل واتساب متفرقة.",
  },
];

/** For office owners: what the platform does, and how to publish offers here. */
function ForOffices() {
  return (
    <section id="features" dir="rtl" lang="ar">
      <div className="bg-foreground px-5 py-16 text-background md:py-[72px]">
        <div className="mx-auto grid max-w-[1240px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-[18px]">
            <span className="text-sm font-semibold text-[#FF6B50]">للمكاتب العقارية</span>
            <h2 className="text-3xl leading-[1.3] font-bold text-pretty md:text-[44px]">
              من واتساب وإكسل إلى نظام واحد يعرفه المالك والمستأجر
            </h2>
            <p className="max-w-[620px] text-[17px] leading-[1.8] text-pretty text-background/80">
              الوحدات والعقود والتحصيل والصيانة والفواتير الإلكترونية في مكان واحد، مع بوابة لكل
              مالك ومستأجر، وإعلاناتك تظهر تلقائياً في سوق جارك.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button asChild className="h-[52px] px-6 text-base">
                <Link to="/register-office">سجّل مكتبك</Link>
              </Button>
              <DemoRequestDialog
                trigger={
                  <button
                    type="button"
                    className="flex h-[52px] items-center border-[1.5px] border-background px-6 text-base font-semibold transition-colors hover:bg-background/10"
                  >
                    احجز عرضاً توضيحياً
                  </button>
                }
              />
              <Link
                to="/offices"
                className="flex h-[52px] items-center px-2 text-base font-semibold underline underline-offset-[5px] transition-colors hover:text-[#FF6B50]"
              >
                تصفّح المكاتب
              </Link>
            </div>
          </div>
          {/* The arch: "your home" — the logo's curve, here as the hero's single image. */}
          <div
            className="hidden h-[380px] place-items-center overflow-hidden rounded-arch bg-sidebar-accent lg:grid"
            aria-hidden
          >
            <JarakSymbol className="size-48 text-background" />
          </div>
        </div>
      </div>
      <div className="mx-auto grid max-w-[1240px] grid-cols-[repeat(auto-fit,minmax(240px,1fr))] px-5 pt-12 pb-[72px]">
        {PILLARS.map((p) => (
          <article
            key={p.n}
            className="flex flex-col gap-2.5 bg-card p-6 shadow-[inset_0_0_0_1px_var(--color-border)]"
          >
            <span className="font-[Archivo] text-sm font-extrabold text-red-text">{p.n}</span>
            <h3 className="text-[19px] font-bold">{p.title}</h3>
            <p className="text-[15px] leading-[1.7] text-muted-foreground">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
