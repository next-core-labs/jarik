import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type NearbyKind =
  | "mosque"
  | "school"
  | "market"
  | "health"
  | "park"
  | "fuel"
  | "food"
  | "mall"
  | "transit"
  | "other";

export type NearbyPlace = {
  name: string;
  kind: NearbyKind;
  lat: number;
  lng: number;
};

const KIND_LABEL_AR: Record<NearbyKind, string> = {
  mosque: "مسجد",
  school: "مدرسة",
  market: "سوق",
  health: "مرفق صحي",
  park: "حديقة",
  fuel: "محطة وقود",
  food: "مطعم",
  mall: "مول",
  transit: "محطة نقل",
  other: "موقع قريب",
};

/** At most this many of each kind — the closest — so busy kinds (cafés) never crowd out the rest. */
const PER_KIND = 5;

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function classify(tags: Record<string, string> = {}): NearbyKind {
  const amenity = tags["amenity"];
  const shop = tags["shop"];
  if (amenity === "place_of_worship") return "mosque";
  if (amenity === "school") return "school";
  if (shop === "mall") return "mall";
  if (shop === "supermarket" || amenity === "marketplace") return "market";
  if (amenity === "hospital" || amenity === "clinic" || amenity === "pharmacy") return "health";
  if (tags["leisure"] === "park") return "park";
  if (amenity === "fuel") return "fuel";
  if (amenity === "restaurant" || amenity === "cafe" || amenity === "fast_food") return "food";
  if (
    tags["public_transport"] === "station" ||
    tags["railway"] === "station" ||
    tags["highway"] === "bus_stop"
  ) {
    return "transit";
  }
  return "other";
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Keep the closest PER_KIND of each kind, closest first overall. */
export function pickNearest(
  origin: { lat: number; lng: number },
  places: NearbyPlace[],
): NearbyPlace[] {
  const taken = new Map<NearbyKind, number>();
  return places
    .map((p) => ({ p, d: metres(origin, p) }))
    .sort((a, b) => a.d - b.d)
    .filter(({ p }) => {
      const n = taken.get(p.kind) ?? 0;
      if (n >= PER_KIND) return false;
      taken.set(p.kind, n + 1);
      return true;
    })
    .map(({ p }) => p);
}

/**
 * أقرب الخدمات لإحداثية عامة (Overpass API — بيانات OSM المفتوحة، بلا مفتاح مدفوع): مساجد، مدارس،
 * أسواق، مستشفيات وصيدليات، حدائق، محطات وقود، مطاعم ومقاهٍ، مولات، ومحطات نقل عام.
 */
export const nearbyPlaces = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const at = (r: number) => `(around:${r},${data.lat},${data.lng})`;
    const wide = at(1500);
    // Restaurants and bus stops are dense — a tighter circle keeps the answer small and relevant.
    const near = at(800);
    const query = `[out:json][timeout:12];(
      nwr["amenity"="place_of_worship"]["religion"="muslim"]${wide};
      nwr["amenity"="school"]${wide};
      nwr["shop"~"^(supermarket|mall)$"]${wide};
      nwr["amenity"="marketplace"]${wide};
      nwr["amenity"~"^(hospital|clinic|pharmacy)$"]${wide};
      nwr["leisure"="park"]${wide};
      nwr["amenity"="fuel"]${wide};
      nwr["amenity"~"^(restaurant|cafe|fast_food)$"]${near};
      nwr["public_transport"="station"]${wide};
      nwr["railway"="station"]${wide};
      node["highway"="bus_stop"]${near};
    );out center 300;`;

    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        // Overpass answers 406 to requests without a descriptive User-Agent (the runtime's default
        // one included) — which used to surface here as "no nearby places" everywhere.
        headers: { "Content-Type": "text/plain", "User-Agent": "Jark/1.0 (nearby places lookup)" },
        body: query,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { places: [] as NearbyPlace[] };
      const json = (await res.json()) as { elements?: OverpassElement[] };

      const places: NearbyPlace[] = [];
      for (const el of json.elements ?? []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const kind = classify(el.tags);
        places.push({
          name: el.tags?.["name:ar"] ?? el.tags?.["name"] ?? KIND_LABEL_AR[kind],
          kind,
          lat,
          lng: lon,
        });
      }
      return { places: pickNearest(data, places) };
    } catch {
      // Overpass تحت ضغط أو غير متاحة — نعرض القسم بلا نقاط بدل كسر صفحة العرض.
      return { places: [] as NearbyPlace[] };
    }
  });
