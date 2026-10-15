import { describe, expect, it } from "vitest";

import { classify, pickNearest, type NearbyPlace } from "@/lib/nearby-places.functions";

describe("classify", () => {
  it("maps OSM tags to the design's service kinds", () => {
    expect(classify({ amenity: "place_of_worship", religion: "muslim" })).toBe("mosque");
    expect(classify({ amenity: "school" })).toBe("school");
    expect(classify({ shop: "supermarket" })).toBe("market");
    expect(classify({ shop: "mall" })).toBe("mall");
    expect(classify({ amenity: "pharmacy" })).toBe("health");
    expect(classify({ leisure: "park" })).toBe("park");
    expect(classify({ amenity: "fuel" })).toBe("fuel");
    expect(classify({ amenity: "cafe" })).toBe("food");
    expect(classify({ highway: "bus_stop" })).toBe("transit");
    expect(classify({ amenity: "bench" })).toBe("other");
  });
});

describe("pickNearest", () => {
  const origin = { lat: 24.8, lng: 46.6 };
  const at = (kind: NearbyPlace["kind"], i: number): NearbyPlace => ({
    name: `${kind}-${i}`,
    kind,
    lat: origin.lat + i / 1000,
    lng: origin.lng,
  });

  it("keeps the closest five of each kind, nearest first overall", () => {
    const cafes = Array.from({ length: 12 }, (_, i) => at("food", i + 1));
    const mosque = at("mosque", 20);
    const picked = pickNearest(origin, [mosque, ...cafes.reverse()]);
    expect(picked.filter((p) => p.kind === "food").map((p) => p.name)).toEqual([
      "food-1",
      "food-2",
      "food-3",
      "food-4",
      "food-5",
    ]);
    expect(picked.at(-1)).toEqual(mosque);
  });
});
