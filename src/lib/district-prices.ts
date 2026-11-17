import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * أسعار الأحياء العامة (/prices): متوسطات الأسعار المطلوبة من district_price_stats — وهو VIEW مشتق
 * من vacant_units_public نفسه، فالصفحات وبياناتها المنظّمة (JSON-LD) لا تكشف إلا عروضًا منشورة
 * علنًا أصلًا (قاعدة AGENTS.md). الأرقام أسعار معروضة، وليست أسعار صفقات موثقة.
 */
export type PriceStatRow = Database["public"]["Views"]["district_price_stats"]["Row"];

export type PriceStat = {
  city: string;
  district: string;
  purpose: "rent" | "sale";
  unitType: string;
  listings: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  avgArea: number | null;
};

/** أقل من 3 عروض لا تصنع «متوسطًا» — نفس قاعدة «إيجارك مقارنة بالحي» في لوحة المالك. */
export const MIN_LISTINGS_FOR_STATS = 3;

export function toPriceStat(row: PriceStatRow): PriceStat | null {
  if (!row.city || !row.district || !row.unit_type) return null;
  if ((row.listings ?? 0) < MIN_LISTINGS_FOR_STATS) return null;
  const avg = Number(row.avg_price ?? 0);
  if (avg <= 0) return null;
  return {
    city: row.city,
    district: row.district,
    purpose: row.listing_purpose === "sale" ? "sale" : "rent",
    unitType: row.unit_type,
    listings: row.listings ?? 0,
    avgPrice: avg,
    minPrice: Number(row.min_price ?? avg),
    maxPrice: Number(row.max_price ?? avg),
    avgArea: row.avg_area != null && row.avg_area > 0 ? Number(row.avg_area) : null,
  };
}

export async function loadDistrictPrices(): Promise<PriceStat[]> {
  const { data, error } = await supabase.from("district_price_stats").select("*").limit(2000);
  if (error) throw error;
  return (data ?? []).map(toPriceStat).filter((s): s is PriceStat => s !== null);
}

/** سطر حي واحد في جدول المدينة: متوسط إيجار/بيع مرجّح بعدد العروض، عبر كل أنواع الوحدات. */
export type DistrictSummary = {
  district: string;
  listings: number;
  avgRent: number | null;
  avgSale: number | null;
};

export type CitySummary = { city: string; listings: number; districts: DistrictSummary[] };

/** متوسطا الإيجار والبيع لمجموعة إحصاءات (حي واحد عادة)، مرجّحين بعدد العروض — مادة المقارنة بين حيين. */
export function purposeAverages(stats: PriceStat[]): {
  avgRent: number | null;
  avgSale: number | null;
  listings: number;
} {
  return {
    avgRent: weightedAvg(stats.filter((r) => r.purpose === "rent")),
    avgSale: weightedAvg(stats.filter((r) => r.purpose === "sale")),
    listings: stats.reduce((s, r) => s + r.listings, 0),
  };
}

function weightedAvg(stats: PriceStat[]): number | null {
  const n = stats.reduce((s, r) => s + r.listings, 0);
  if (n === 0) return null;
  return Math.round(stats.reduce((s, r) => s + r.avgPrice * r.listings, 0) / n);
}

/** المدن وأحياؤها مرتبة بعدد العروض — مادة صفحة /prices. */
export function groupByCity(stats: PriceStat[]): CitySummary[] {
  const byCity = new Map<string, Map<string, PriceStat[]>>();
  for (const s of stats) {
    const districts = byCity.get(s.city) ?? new Map<string, PriceStat[]>();
    districts.set(s.district, [...(districts.get(s.district) ?? []), s]);
    byCity.set(s.city, districts);
  }
  return [...byCity.entries()]
    .map(([city, districts]) => {
      const rows: DistrictSummary[] = [...districts.entries()]
        .map(([district, list]) => ({
          district,
          listings: list.reduce((s, r) => s + r.listings, 0),
          avgRent: weightedAvg(list.filter((r) => r.purpose === "rent")),
          avgSale: weightedAvg(list.filter((r) => r.purpose === "sale")),
        }))
        .sort((a, b) => b.listings - a.listings || a.district.localeCompare(b.district, "ar"));
      return {
        city,
        listings: rows.reduce((s, r) => s + r.listings, 0),
        districts: rows,
      };
    })
    .sort((a, b) => b.listings - a.listings || a.city.localeCompare(b.city, "ar"));
}

export function districtPricesPath(city: string, district: string): string {
  return `/prices/${encodeURIComponent(city)}/${encodeURIComponent(district)}`;
}

// ── تاريخ الأسعار: لقطات district_price_history اليومية (snapshot_district_prices) ──────────────

export type PriceHistoryRow = Database["public"]["Tables"]["district_price_history"]["Row"];

/** نقطة واحدة على رسم «تغيّر السعر»: متوسط اليوم مرجّحًا بعدد العروض عبر كل أنواع الوحدات. */
export type PricePoint = { date: string; avgPrice: number; listings: number };

/** آخر 180 يومًا تكفي للرسم؛ الحي الواحد صغير فالقراءة بالفلاتر لا الجدول كاملًا. */
const HISTORY_DAYS = 180;

export async function loadDistrictHistory(
  city: string,
  district: string,
): Promise<PriceHistoryRow[]> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("district_price_history")
    .select("*")
    .eq("city", city)
    .eq("district", district)
    .gte("snapshot_date", since)
    .order("snapshot_date")
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

/** سلسلة الرسم لغرض واحد: يوم بأقل من 3 عروض لا يصنع نقطة — نفس قاعدة MIN_LISTINGS_FOR_STATS. */
export function historySeries(rows: PriceHistoryRow[], purpose: "rent" | "sale"): PricePoint[] {
  const byDate = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const p = r.listing_purpose === "sale" ? "sale" : "rent";
    if (p !== purpose || !r.snapshot_date || r.avg_price <= 0 || r.listings <= 0) continue;
    const acc = byDate.get(r.snapshot_date) ?? { sum: 0, n: 0 };
    acc.sum += Number(r.avg_price) * r.listings;
    acc.n += r.listings;
    byDate.set(r.snapshot_date, acc);
  }
  return [...byDate.entries()]
    .filter(([, acc]) => acc.n >= MIN_LISTINGS_FOR_STATS)
    .map(([date, acc]) => ({ date, avgPrice: Math.round(acc.sum / acc.n), listings: acc.n }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** تغيّر السلسلة من أولها إلى آخرها: النسبة وطول الفترة بالأيام — أو null بأقل من نقطتين. */
export function seriesTrend(points: PricePoint[]): { pct: number; days: number } | null {
  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.avgPrice <= 0) return null;
  const days = Math.round(
    (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000,
  );
  if (days <= 0) return null;
  return { pct: Math.round(((last.avgPrice - first.avgPrice) / first.avgPrice) * 100), days };
}

// ── «هذا الإعلان مقارنة بمتوسط الحي» في صفحة العرض ──────────────────────────────────────────────

/** إحصاءة الحي المطابقة لإعلان واحد (نفس المدينة والحي والنوع والغرض) — أو null بلا بيانات كافية. */
export async function loadListingDistrictStat(listing: {
  city: string | null;
  district: string | null;
  unitType: string;
  purpose: "rent" | "sale";
}): Promise<PriceStat | null> {
  if (!listing.city || !listing.district || !listing.unitType) return null;
  const { data, error } = await supabase
    .from("district_price_stats")
    .select("*")
    .eq("city", listing.city)
    .eq("district", listing.district)
    .eq("unit_type", listing.unitType)
    .eq("listing_purpose", listing.purpose)
    .limit(1);
  if (error) return null;
  const row = data?.[0];
  return row ? toPriceStat(row) : null;
}

/**
 * فرق سعر الإعلان عن متوسط حيّه بالنسبة المئوية (سالب = أرخص من المتوسط)، أو null حين لا معنى
 * للمقارنة: متوسط من إعلانين أو أقل، أو فرق أقل من 2% (عمليًا «بسعر الحي»).
 */
export function vsDistrictPct(price: number, stat: PriceStat | null): number | null {
  if (!stat || price <= 0 || stat.avgPrice <= 0) return null;
  const pct = Math.round(((price - stat.avgPrice) / stat.avgPrice) * 100);
  return Math.abs(pct) < 2 ? null : pct;
}
