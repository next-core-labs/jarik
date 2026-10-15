import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";

import {
  formatDistance,
  formatNumber,
  tf,
  travelTime,
  walkMinutes,
} from "@/components/listing-detail/format";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale, TranslationKey } from "@/lib/i18n";
import { distanceMeters, NEARBY_KIND_GLYPH } from "@/lib/map-markers";
import { nearbyPlaces, type NearbyPlace } from "@/lib/nearby-places.functions";
import { cn } from "@/lib/utils";

const NearbyPlacesMap = lazy(() => import("@/components/nearby-places-map"));

type Kind = NearbyPlace["kind"];

/** Chip order, and each kind's plural (chip) and singular (list row) labels. */
const KINDS: { kind: Kind; group: TranslationKey; one: TranslationKey }[] = [
  { kind: "mosque", group: "ld_nearby_group_mosque", one: "ld_nearby_kind_mosque" },
  { kind: "school", group: "ld_nearby_group_school", one: "ld_nearby_kind_school" },
  { kind: "market", group: "ld_nearby_group_market", one: "ld_nearby_kind_market" },
  { kind: "health", group: "ld_nearby_group_health", one: "ld_nearby_kind_health" },
  { kind: "park", group: "ld_nearby_group_park", one: "ld_nearby_kind_park" },
  { kind: "transit", group: "ld_nearby_group_transit", one: "ld_nearby_kind_transit" },
  { kind: "fuel", group: "ld_nearby_group_fuel", one: "ld_nearby_kind_fuel" },
  { kind: "food", group: "ld_nearby_group_food", one: "ld_nearby_kind_food" },
  { kind: "mall", group: "ld_nearby_group_mall", one: "ld_nearby_kind_mall" },
  { kind: "other", group: "ld_nearby_group_other", one: "ld_nearby_kind_other" },
];
/** Off until the visitor asks: everyday errands rather than what a family checks first (the mock's
 *  defaults). */
const DEFAULT_OFF: Partial<Record<Kind, boolean>> = { fuel: true, food: true, mall: true };
const SINGULAR = Object.fromEntries(KINDS.map((k) => [k.kind, k.one])) as Record<
  Kind,
  TranslationKey
>;

const MAP_HEIGHT = "h-[360px]";

/**
 * «ماذا يوجد بالقرب؟» on the listing page — only rendered when the property has a known coordinate.
 * An ink summary strip, one toggle chip per kind of place found, then the map beside the list of
 * the places whose kind is switched on.
 */
export function NearbyPlacesSection({
  lat,
  lng,
  locale = "ar",
}: {
  lat: number;
  lng: number;
  locale?: Locale;
}) {
  const fetchPlaces = useServerFn(nearbyPlaces);
  const query = useQuery({
    queryKey: ["nearby-places", lat, lng],
    queryFn: () => fetchPlaces({ data: { lat, lng } }),
    staleTime: 60 * 60 * 1000,
  });

  // Every place with its distance from the listing (km), nearest first.
  const places = useMemo(
    () =>
      (query.data?.places ?? [])
        .map((p) => ({ ...p, km: distanceMeters({ lat, lng }, p) / 1000 }))
        .sort((a, b) => a.km - b.km),
    [query.data, lat, lng],
  );

  const [off, setOff] = useState<Partial<Record<Kind, boolean>>>(DEFAULT_OFF);
  const shown = useMemo(() => places.filter((p) => !off[p.kind]), [places, off]);
  // The map redraws its markers whenever this array changes identity — keep it stable.
  const mapPlaces = useMemo<NearbyPlace[]>(
    () =>
      shown.map(({ name, kind, lat: pLat, lng: pLng }) => ({ name, kind, lat: pLat, lng: pLng })),
    [shown],
  );

  const chips = KINDS.map((k) => ({
    ...k,
    count: places.filter((p) => p.kind === k.kind).length,
  })).filter((k) => k.count > 0);

  const mosque = places.find((p) => p.kind === "mosque");
  const schools = places.filter((p) => p.kind === "school" && p.km <= 1.5).length;
  const walkable = places.filter((p) => p.km <= 0.8).length >= 6;
  const score: [string, string][] = [
    [
      tf(locale, "ld_nearby_mosque"),
      mosque
        ? tf(locale, "ld_nearby_walk_min", { n: formatNumber(walkMinutes(mosque.km), locale) })
        : "—",
    ],
    [tf(locale, "ld_nearby_schools"), schools > 0 ? formatNumber(schools, locale) : "—"],
    [
      tf(locale, "ld_nearby_walkability"),
      tf(locale, walkable ? "ld_nearby_walk_high" : "ld_nearby_walk_mid"),
    ],
  ];

  const mapSkeleton = <Skeleton className={cn(MAP_HEIGHT, "w-full")} />;
  const map = (
    <Suspense fallback={mapSkeleton}>
      <NearbyPlacesMap lat={lat} lng={lng} places={mapPlaces} className={MAP_HEIGHT} />
    </Suspense>
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 className="text-xl font-bold">{tf(locale, "ld_nearby_title")}</h2>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {tf(locale, "ld_nearby_approx")}
        </span>
      </div>

      {query.isLoading ? (
        <>
          <Skeleton className="h-[76px] w-full" />
          {mapSkeleton}
        </>
      ) : places.length === 0 ? (
        <>
          <div className="border border-border bg-card">{map}</div>
          <p className="text-sm text-muted-foreground">{tf(locale, "ld_nearby_empty")}</p>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-3 bg-foreground text-background">
            {score.map(([k, v]) => (
              <div
                key={k}
                className="flex flex-col gap-1 p-3 not-last:border-e not-last:border-background/15 sm:p-4"
              >
                <dt className="text-[13px] text-background/70">{k}</dt>
                <dd className="text-lg font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap gap-1.5">
            {chips.map((c) => {
              const on = !off[c.kind];
              return (
                <button
                  key={c.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setOff((s) => ({ ...s, [c.kind]: on }))}
                  className={cn(
                    "flex h-[38px] cursor-pointer items-center gap-[7px] px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
                    on
                      ? "bg-foreground text-background"
                      : "bg-card text-foreground shadow-[inset_0_0_0_1px_var(--color-input)] hover:bg-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("size-[9px]", on ? "bg-background" : "bg-subtle-foreground")}
                  />
                  {tf(locale, c.group)}
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      on ? "text-background/70" : "text-muted-foreground",
                    )}
                  >
                    {formatNumber(c.count, locale)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid border border-border bg-card md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="relative">{map}</div>
            <ul className="flex max-h-[360px] flex-col overflow-y-auto">
              {shown.map((p, i) => (
                <li
                  key={`${p.kind}-${p.lat}-${p.lng}-${i}`}
                  className="flex items-center gap-3 border-b border-muted px-4 py-3"
                >
                  <span
                    aria-hidden
                    className="grid size-[30px] flex-none place-items-center bg-muted text-xs font-bold"
                  >
                    {NEARBY_KIND_GLYPH[p.kind]}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {tf(locale, SINGULAR[p.kind])}
                    </span>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-px">
                    <span className="text-sm font-semibold tabular-nums">
                      {formatDistance(p.km * 1000, locale)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {travelTime(p.km, locale)}
                    </span>
                  </div>
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="px-4 py-6 text-sm text-muted-foreground">
                  {tf(locale, "ld_nearby_none_on")}
                </li>
              ) : null}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
