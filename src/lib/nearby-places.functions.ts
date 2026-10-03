import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type NearbyPlace = {
  name: string;
  kind: "school" | "mosque" | "market" | "other";
  lat: number;
  lng: number;
};

const KIND_BY_TAG: Record<string, NearbyPlace["kind"]> = {
  school: "school",
  place_of_worship: "mosque",
  supermarket: "market",
  mall: "market",
  marketplace: "market",
};

const KIND_LABEL_AR: Record<NearbyPlace["kind"], string> = {
  school: "مدرسة",
  mosque: "مسجد",
  market: "سوق",
  other: "موقع قريب",
};

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** أقرب مدارس ومساجد وأسواق لإحداثية عامة (Overpass API — بيانات OSM المفتوحة، بلا مفتاح مدفوع). */
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
    const radius = 1500;
    const query = `[out:json][timeout:10];(
      node["amenity"="school"](around:${radius},${data.lat},${data.lng});
      node["amenity"="place_of_worship"]["religion"="muslim"](around:${radius},${data.lat},${data.lng});
      node["shop"="supermarket"](around:${radius},${data.lat},${data.lng});
      node["shop"="mall"](around:${radius},${data.lat},${data.lng});
    );out center 15;`;

    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { places: [] as NearbyPlace[] };
      const json = (await res.json()) as { elements?: OverpassElement[] };

      const places: NearbyPlace[] = [];
      for (const el of json.elements ?? []) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const tagKey = el.tags?.["amenity"] ?? el.tags?.["shop"] ?? "";
        const kind = KIND_BY_TAG[tagKey] ?? "other";
        places.push({ name: el.tags?.["name"] ?? KIND_LABEL_AR[kind], kind, lat, lng: lon });
      }
      return { places: places.slice(0, 15) };
    } catch {
      // Overpass تحت ضغط أو غير متاحة — نعرض القسم بلا نقاط بدل كسر صفحة العرض.
      return { places: [] as NearbyPlace[] };
    }
  });
