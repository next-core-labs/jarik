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

/** `failed` = the lookup itself didn't answer (timeout, rate limit, outage), so the UI says
 *  "couldn't load" and offers a retry instead of claiming nothing is nearby. */
export type NearbyPlacesResult = { places: NearbyPlace[]; failed: boolean };

const FAILED: NearbyPlacesResult = { places: [], failed: true };

/** Public Overpass instances. Each one is regularly slow or down on its own, so the lookup asks
 *  all of them at once and takes the first real answer. */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const LOOKUP_TIMEOUT_MS = 20_000;
/** What is around a spot changes slowly — a good answer is reused for a week. */
const CACHE_SECONDS = 7 * 24 * 60 * 60;

/** Parse one Overpass answer; throws when it is not a real answer, so the race moves on. */
export function parseOverpass(json: { elements?: OverpassElement[]; remark?: string }) {
  // Overpass reports its own timeouts and memory limits as a 200 with a "remark" — that is a
  // failure too, not an empty neighbourhood.
  if (json.remark && /error/i.test(json.remark) && !json.elements?.length) {
    throw new Error("overpass-remark");
  }
  if (!Array.isArray(json.elements)) throw new Error("overpass-shape");
  const places: NearbyPlace[] = [];
  for (const el of json.elements) {
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
  return places;
}

async function askOverpass(endpoint: string, query: string, signal: AbortSignal) {
  const res = await fetch(endpoint, {
    method: "POST",
    // Overpass answers 406 to requests without a descriptive User-Agent (the runtime's default
    // one included) — which used to surface here as "no nearby places" everywhere.
    headers: { "Content-Type": "text/plain", "User-Agent": "Jark/1.0 (nearby places lookup)" },
    body: query,
    signal,
  });
  if (!res.ok) throw new Error(`overpass-${res.status}`);
  return parseOverpass((await res.json()) as { elements?: OverpassElement[]; remark?: string });
}

/** The Workers edge cache; absent in local dev and tests, where every lookup goes to Overpass. */
function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

/**
 * أقرب الخدمات لإحداثية عامة (Overpass API — بيانات OSM المفتوحة، بلا مفتاح مدفوع): مساجد، مدارس،
 * أسواق، مستشفيات وصيدليات، حدائق، محطات وقود، مطاعم ومقاهٍ، مولات، ومحطات نقل عام.
 */
export const nearbyPlaces = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<NearbyPlacesResult> => {
    // The search is centred on the spot rounded to ~100 m, so neighbouring units share one cached
    // answer; distances and the nearest-per-kind pick still use the exact spot.
    const lat = data.lat.toFixed(3);
    const lng = data.lng.toFixed(3);
    const cache = edgeCache();
    const cacheKey = `https://nearby-places.jarak.internal/v1/${lat},${lng}`;
    try {
      const hit = await cache?.match(cacheKey);
      if (hit) {
        return { places: pickNearest(data, (await hit.json()) as NearbyPlace[]), failed: false };
      }
    } catch {
      // A cache read that fails is just a miss.
    }

    const at = (r: number) => `(around:${r},${lat},${lng})`;
    const wide = at(1500);
    // Restaurants and bus stops are dense — a tighter circle keeps the answer small and relevant.
    const near = at(800);
    const query = `[out:json][timeout:15];(
      nwr["amenity"="place_of_worship"]["religion"="muslim"]${wide};
      nwr["amenity"~"^(school|marketplace|hospital|clinic|pharmacy|fuel)$"]${wide};
      nwr["shop"~"^(supermarket|mall)$"]${wide};
      nwr["leisure"="park"]${wide};
      nwr["amenity"~"^(restaurant|cafe|fast_food)$"]${near};
      nwr["public_transport"="station"]${wide};
      nwr["railway"="station"]${wide};
      node["highway"="bus_stop"]${near};
    );out center 300;`;

    // One controller for the whole race: the deadline aborts every request, and so does a winner.
    const race = new AbortController();
    const deadline = setTimeout(() => race.abort(), LOOKUP_TIMEOUT_MS);
    try {
      const all = await Promise.any(
        OVERPASS_ENDPOINTS.map((endpoint) => askOverpass(endpoint, query, race.signal)),
      );
      try {
        await cache?.put(
          cacheKey,
          new Response(JSON.stringify(all), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
            },
          }),
        );
      } catch {
        // Not being able to store the answer never fails the lookup.
      }
      return { places: pickNearest(data, all), failed: false };
    } catch {
      // كل الخوادم تحت ضغط أو غير متاحة — نُبلغ الواجهة بالفشل (لا «لا خدمات») بدل كسر صفحة العرض.
      return FAILED;
    } finally {
      clearTimeout(deadline);
      race.abort();
    }
  });
