import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin } from "lucide-react";

import { nearbyPlaces } from "@/lib/nearby-places.functions";
import { Skeleton } from "@/components/ui/skeleton";

const NearbyPlacesMap = lazy(() => import("@/components/nearby-places-map"));

const KIND_LABEL: Record<string, string> = {
  school: "مدرسة",
  mosque: "مسجد",
  market: "سوق",
  other: "قريب",
};

/** قسم "الخدمات القريبة" بصفحة عرض الوحدة — لا يظهر إلا لو للعقار إحداثية معروفة. */
export function NearbyPlacesSection({ lat, lng }: { lat: number; lng: number }) {
  const fetchPlaces = useServerFn(nearbyPlaces);
  const query = useQuery({
    queryKey: ["nearby-places", lat, lng],
    queryFn: () => fetchPlaces({ data: { lat, lng } }),
    staleTime: 60 * 60 * 1000,
  });

  const places = query.data?.places ?? [];

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold">
        <MapPin className="size-5 text-brass" aria-hidden />
        الخدمات القريبة
      </h2>
      {query.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <Suspense fallback={<Skeleton className="h-72 w-full" />}>
          <NearbyPlacesMap lat={lat} lng={lng} places={places} />
        </Suspense>
      )}
      {!query.isLoading && places.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          ما لقينا خدمات قريبة مسجّلة بخرائط OpenStreetMap لهذا الموقع.
        </p>
      ) : places.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {places.slice(0, 8).map((p, i) => (
            <li key={i} className="rounded-full border border-border px-2.5 py-1">
              {KIND_LABEL[p.kind] ?? "قريب"} · {p.name}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
