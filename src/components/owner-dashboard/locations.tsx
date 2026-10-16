import { lazy, Suspense, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  Cross,
  Fuel,
  GraduationCap,
  Landmark,
  MapPinOff,
  ShoppingBag,
  ShoppingCart,
  TramFront,
  Trees,
  Undo2,
  UtensilsCrossed,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { arCount, arNum, arPct } from "@/lib/format";
import {
  NEARBY_KIND_COLOR,
  NEARBY_KIND_GLYPH,
  NEARBY_KIND_LABEL,
  OCCUPANCY_COLOR,
  distanceMeters,
  occupancyColor,
} from "@/lib/map-markers";
import { nearbyPlaces, type NearbyPlace } from "@/lib/nearby-places.functions";
import { cn } from "@/lib/utils";
import { Panel, Section } from "@/components/owner-dashboard/parts";
import type { PropertyGroup } from "@/components/owner-dashboard/model";
import type { MapProperty } from "@/components/units-map";

// The same occupancy map as /map, loaded lazily so Leaflet stays out of the dashboard's bundle.
const UnitsMap = lazy(() => import("@/components/units-map"));

const KIND_ICON: Record<NearbyPlace["kind"], typeof Landmark> = {
  mosque: Landmark,
  school: GraduationCap,
  market: ShoppingCart,
  health: Cross,
  park: Trees,
  fuel: Fuel,
  food: UtensilsCrossed,
  mall: ShoppingBag,
  transit: TramFront,
  other: Building2,
};
function distanceLabel(m: number) {
  if (m < 1000) return `${arNum(Math.round(m / 10) * 10)} م`;
  return `${(m / 1000).toLocaleString("ar-SA", { maximumFractionDigits: 1 })} كم`;
}

function toMapProperty(p: PropertyGroup & { location: { lat: number; lng: number } }): MapProperty {
  const occupied = p.units.filter((u) => u.status === "occupied");
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    district: p.district,
    lat: p.location.lat,
    lng: p.location.lng,
    unitsCount: p.units.length,
    occupied: occupied.length,
    vacant: p.units.filter((u) => u.status === "vacant").length,
    sold: p.units.filter((u) => u.status === "sold").length,
    rent: occupied.reduce((s, u) => s + Number(u.lease_annual_rent ?? u.annual_rent ?? 0), 0),
  };
}

/**
 * Where the owner's properties are, coloured by occupancy like /map — and, for the one chosen,
 * the schools, mosques and markets within 1.5 km (OpenStreetMap), nearest first.
 */
export function Locations({
  properties,
  selectedId,
  onSelect,
}: {
  properties: PropertyGroup[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const placed = useMemo(
    () =>
      properties.filter(
        (p): p is PropertyGroup & { location: { lat: number; lng: number } } => !!p.location,
      ),
    [properties],
  );
  // Stable identity: the map rebuilds whenever this array changes.
  const mapProperties = useMemo(() => placed.map(toMapProperty), [placed]);
  const unplaced = properties.filter((p) => !p.location);
  const selected = placed.find((p) => p.id === selectedId) ?? null;

  const fetchPlaces = useServerFn(nearbyPlaces);
  const nearby = useQuery({
    // Same key as the public listing's NearbyPlacesSection, so the two share the cache.
    queryKey: ["nearby-places", selected?.location.lat, selected?.location.lng],
    queryFn: async () => {
      const result = await fetchPlaces({
        data: { lat: selected!.location.lat, lng: selected!.location.lng },
      });
      // A failed lookup is an error, not "nothing nearby" — and errors aren't cached for an hour.
      if (result.failed) throw new Error("nearby-places-failed");
      return result;
    },
    enabled: !!selected,
    staleTime: 60 * 60 * 1000,
    // The lookup already waits up to 10 s; the owner can retry from the message instead.
    retry: false,
  });
  const places = useMemo(() => {
    if (!selected || !nearby.data) return [];
    return nearby.data.places
      .map((p) => ({ ...p, distance: distanceMeters(selected.location, p) }))
      .sort((a, b) => a.distance - b.distance);
  }, [selected, nearby.data]);

  return (
    <Section
      id="map"
      title="الخريطة والجوار"
      description="مواقع عقاراتك بألوان الإشغال — اختر عقارًا لترى ما حوله من مدارس ومساجد وأسواق"
    >
      {placed.length === 0 ? (
        <Panel className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <MapPinOff className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-display text-lg font-bold">لم تُحدَّد مواقع عقاراتك بعد</p>
          <p className="max-w-md text-sm text-muted-foreground">
            يحدّد المكتب موقع كل عقار من عنوانه، وبعدها يظهر هنا على الخريطة مع الخدمات القريبة منه.
          </p>
          <Button variant="outline" asChild>
            <Link to="/messages">اطلب من المكتب تحديد المواقع</Link>
          </Button>
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel className="grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div className="flex flex-col border-b border-border lg:border-b-0 lg:border-e">
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <p className="text-sm font-medium">
                  {arCount(placed.length, {
                    one: "عقار على الخريطة",
                    two: "عقاران على الخريطة",
                    few: "عقارات على الخريطة",
                    many: "عقارًا على الخريطة",
                  })}
                </p>
                {selected ? (
                  <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
                    <Undo2 aria-hidden />
                    عرض الكل
                  </Button>
                ) : null}
              </div>
              <ul className="max-h-[22rem] overflow-y-auto border-t border-border lg:max-h-none lg:flex-1">
                {mapProperties.map((p) => {
                  const on = p.id === selectedId;
                  const rentable = p.unitsCount - p.sold;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => onSelect(on ? null : p.id!)}
                        className={cn(
                          "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-start transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          on ? "bg-foreground text-background" : "hover:bg-background",
                        )}
                      >
                        <span
                          className="size-3 shrink-0 rounded-full ring-2 ring-card"
                          style={{ backgroundColor: occupancyColor(p) }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span
                            className={cn(
                              "block truncate text-xs",
                              on ? "text-background/70" : "text-muted-foreground",
                            )}
                          >
                            {[p.district, p.city].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                        <span className="text-end text-xs">
                          <span className="block font-semibold">
                            {rentable ? arPct(Math.round((p.occupied / rentable) * 100)) : "—"}
                          </span>
                          <span className={on ? "text-background/70" : "text-muted-foreground"}>
                            إشغال
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {unplaced.length > 0 ? (
                <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                  بلا موقع محدد: {unplaced.map((p) => p.name).join("، ")} — يحدّده المكتب من
                  العنوان.
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              <Suspense fallback={<Skeleton className="h-[26rem] w-full lg:h-[30rem]" />}>
                <UnitsMap
                  properties={mapProperties}
                  selectedId={selectedId}
                  onSelect={(id) => onSelect(id)}
                  nearby={places}
                  className="h-[26rem] rounded-none border-0 lg:h-[30rem]"
                />
              </Suspense>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                <LegendDot color={OCCUPANCY_COLOR.full} label="مؤجر بالكامل" />
                <LegendDot color={OCCUPANCY_COLOR.vacant} label="فيه وحدات شاغرة" />
                <LegendDot color={OCCUPANCY_COLOR.none} label="بلا وحدات مؤجرة" />
                {places.length > 0 ? (
                  <>
                    <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
                    {(["school", "mosque", "market"] as const).map((k) => (
                      <LegendDot
                        key={k}
                        color={NEARBY_KIND_COLOR[k]}
                        label={NEARBY_KIND_LABEL[k]}
                        glyph={NEARBY_KIND_GLYPH[k]}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            </div>
          </Panel>

          <NearbyPanel
            property={selected}
            loading={nearby.isLoading}
            failed={nearby.isError}
            retrying={nearby.isFetching}
            onRetry={() => void nearby.refetch()}
            places={places}
          />
        </div>
      )}
    </Section>
  );
}

/** Properties are circles on the map, nearby services squares — the legend keeps the shapes. */
function LegendDot({ color, label, glyph }: { color: string; label: string; glyph?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {glyph ? (
        // Services: the same neutral glyph square the map draws.
        <span
          className="grid size-4 shrink-0 place-items-center text-[9px] font-bold text-white"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {glyph}
        </span>
      ) : (
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}

function NearbyPanel({
  property,
  loading,
  failed,
  retrying,
  onRetry,
  places,
}: {
  property: PropertyGroup | null;
  loading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  places: (NearbyPlace & { distance: number })[];
}) {
  if (!property) {
    return (
      <Panel className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm text-muted-foreground">
        <Landmark className="size-5 shrink-0" aria-hidden />
        اختر عقارًا من القائمة أو من الخريطة لترى المدارس والمساجد والأسواق في نطاق ١٫٥ كم منه — ما
        يبحث عنه المستأجر قبل أن يقرّر.
      </Panel>
    );
  }
  const kinds = (["school", "mosque", "market"] as const).map((k) => ({
    kind: k,
    items: places.filter((p) => p.kind === k),
  }));
  return (
    <Panel>
      <div className="px-5 pt-5">
        <h3 className="font-display font-bold">ما حول {property.name}</h3>
        <p className="text-sm text-muted-foreground">في نطاق ١٫٥ كم · المسافات بخط مستقيم</p>
      </div>
      {loading ? (
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : failed ? (
        <div className="flex flex-wrap items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
          <p>تعذّر تحميل الخدمات القريبة.</p>
          <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
            {retrying ? "جارٍ المحاولة..." : "إعادة المحاولة"}
          </Button>
        </div>
      ) : places.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted-foreground">
          لم نجد خدمات قريبة مسجّلة في خرائط OpenStreetMap لهذا الموقع.
        </p>
      ) : (
        <>
          <dl className="mx-5 mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-border border-y border-border py-3">
            {kinds.map(({ kind, items }) => {
              const Icon = KIND_ICON[kind];
              return (
                <div key={kind} className="px-3 text-center">
                  <dt className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <Icon
                      className="size-3.5"
                      style={{ color: NEARBY_KIND_COLOR[kind] }}
                      aria-hidden
                    />
                    {NEARBY_KIND_LABEL[kind]}
                  </dt>
                  <dd className="mt-1 font-display text-lg font-bold">
                    {items.length ? arNum(items.length) : "—"}
                  </dd>
                  <dd className="text-[11px] text-muted-foreground">
                    {items[0] ? `الأقرب ${distanceLabel(items[0].distance)}` : "لا يوجد"}
                  </dd>
                </div>
              );
            })}
          </dl>
          <ul className="grid gap-x-6 px-5 py-2 sm:grid-cols-2">
            {places.slice(0, 10).map((p, i) => {
              const Icon = KIND_ICON[p.kind];
              return (
                <li
                  key={`${p.name}-${i}`}
                  className="flex items-center gap-3 border-b border-border py-2.5 text-sm"
                >
                  <Icon
                    className="size-4 shrink-0"
                    style={{ color: NEARBY_KIND_COLOR[p.kind] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {distanceLabel(p.distance)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="px-5 pb-4 pt-2 text-xs text-muted-foreground">
            {arCount(places.length, {
              one: "موقع واحد قريب",
              two: "موقعان قريبان",
              few: "مواقع قريبة",
              many: "موقعًا قريبًا",
            })}{" "}
            · بيانات © OpenStreetMap
          </p>
        </>
      )}
    </Panel>
  );
}
