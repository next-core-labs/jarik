import { describe, expect, it } from "vitest";

import {
  districtPricesPath,
  groupByCity,
  historySeries,
  purposeAverages,
  seriesTrend,
  toPriceStat,
  vsDistrictPct,
  type PriceHistoryRow,
  type PricePoint,
  type PriceStat,
  type PriceStatRow,
} from "./district-prices";

const row = (over: Partial<PriceStatRow> = {}): PriceStatRow => ({
  city: "الرياض",
  district: "الملقا",
  listing_purpose: "rent",
  unit_type: "شقة",
  listings: 5,
  avg_price: 42000,
  min_price: 30000,
  max_price: 60000,
  avg_area: 140,
  ...over,
});

const stat = (over: Partial<PriceStat> = {}): PriceStat => ({
  city: "الرياض",
  district: "الملقا",
  purpose: "rent",
  unitType: "شقة",
  listings: 5,
  avgPrice: 42000,
  minPrice: 30000,
  maxPrice: 60000,
  avgArea: 140,
  ...over,
});

describe("toPriceStat", () => {
  it("keeps a row only with 3+ listings, a positive average, and a full location", () => {
    expect(toPriceStat(row())).toMatchObject({ purpose: "rent", avgPrice: 42000 });
    expect(toPriceStat(row({ listings: 2 }))).toBeNull();
    expect(toPriceStat(row({ avg_price: 0 }))).toBeNull();
    expect(toPriceStat(row({ city: null }))).toBeNull();
    expect(toPriceStat(row({ district: null }))).toBeNull();
  });

  it("drops a zero area instead of showing «0 م²»", () => {
    expect(toPriceStat(row({ avg_area: 0 }))?.avgArea).toBeNull();
  });
});

describe("groupByCity", () => {
  it("weights the district average by listings and splits rent from sale", () => {
    const grouped = groupByCity([
      stat({ listings: 3, avgPrice: 30000 }),
      stat({ unitType: "فيلا", listings: 6, avgPrice: 60000 }),
      stat({ purpose: "sale", unitType: "فيلا", listings: 3, avgPrice: 2_000_000 }),
    ]);
    expect(grouped).toHaveLength(1);
    const district = grouped[0]!.districts[0]!;
    expect(district.listings).toBe(12);
    expect(district.avgRent).toBe(50000); // (3×30k + 6×60k) / 9
    expect(district.avgSale).toBe(2_000_000);
  });

  it("orders cities and districts by how much is listed there", () => {
    const grouped = groupByCity([
      stat({ city: "جدة", district: "الشاطئ", listings: 3 }),
      stat({ listings: 10 }),
      stat({ district: "النرجس", listings: 4 }),
    ]);
    expect(grouped.map((c) => c.city)).toEqual(["الرياض", "جدة"]);
    expect(grouped[0]!.districts.map((d) => d.district)).toEqual(["الملقا", "النرجس"]);
  });
});

describe("districtPricesPath", () => {
  it("URL-encodes the Arabic city and district", () => {
    const path = districtPricesPath("الرياض", "حي الملقا");
    expect(path.startsWith("/prices/")).toBe(true);
    expect(decodeURIComponent(path)).toBe("/prices/الرياض/حي الملقا");
    expect(path).not.toContain(" ");
  });
});

const hist = (over: Partial<PriceHistoryRow> = {}): PriceHistoryRow => ({
  snapshot_date: "2026-11-01",
  city: "الرياض",
  district: "الملقا",
  listing_purpose: "rent",
  unit_type: "شقة",
  listings: 5,
  avg_price: 40000,
  min_price: 30000,
  max_price: 60000,
  avg_area: 140,
  ...over,
});

describe("historySeries", () => {
  it("weights each day's point by listings across unit types, for one purpose", () => {
    const points = historySeries(
      [
        hist({ listings: 3, avg_price: 30000 }),
        hist({ unit_type: "فيلا", listings: 6, avg_price: 60000 }),
        hist({ snapshot_date: "2026-11-02", listings: 4, avg_price: 44000 }),
        hist({ listing_purpose: "sale", listings: 9, avg_price: 2_000_000 }),
      ],
      "rent",
    );
    expect(points).toEqual([
      { date: "2026-11-01", avgPrice: 50000, listings: 9 }, // (3×30k + 6×60k) / 9
      { date: "2026-11-02", avgPrice: 44000, listings: 4 },
    ]);
  });

  it("drops a day with fewer than 3 listings — same MIN_LISTINGS_FOR_STATS rule", () => {
    expect(historySeries([hist({ listings: 2 })], "rent")).toEqual([]);
  });
});

describe("seriesTrend", () => {
  const pt = (date: string, avgPrice: number): PricePoint => ({ date, avgPrice, listings: 5 });

  it("reports the percent change from the first point to the last, with the span in days", () => {
    expect(seriesTrend([pt("2026-10-01", 40000), pt("2026-10-31", 44000)])).toEqual({
      pct: 10,
      days: 30,
    });
  });

  it("needs at least two points on different days", () => {
    expect(seriesTrend([pt("2026-10-01", 40000)])).toBeNull();
    expect(seriesTrend([pt("2026-10-01", 40000), pt("2026-10-01", 44000)])).toBeNull();
  });
});

describe("purposeAverages", () => {
  it("splits rent from sale with listings-weighted averages", () => {
    expect(
      purposeAverages([
        stat({ listings: 3, avgPrice: 30000 }),
        stat({ unitType: "فيلا", listings: 6, avgPrice: 60000 }),
        stat({ purpose: "sale", listings: 3, avgPrice: 2_000_000 }),
      ]),
    ).toEqual({ avgRent: 50000, avgSale: 2_000_000, listings: 12 });
  });
});

describe("vsDistrictPct", () => {
  it("compares a listing's price to the district average", () => {
    expect(vsDistrictPct(46200, stat({ avgPrice: 42000 }))).toBe(10);
    expect(vsDistrictPct(37800, stat({ avgPrice: 42000 }))).toBe(-10);
  });

  it("stays quiet within ±2% and without a stat — «بسعر الحي» is not a finding", () => {
    expect(vsDistrictPct(42400, stat({ avgPrice: 42000 }))).toBeNull();
    expect(vsDistrictPct(46200, null)).toBeNull();
    expect(vsDistrictPct(0, stat())).toBeNull();
  });
});
