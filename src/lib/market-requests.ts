import { normalizeArabic } from "@/lib/market";
import { isPurpose, type ListingPurpose } from "@/lib/property-types";

/** ما يراه أي زائر، حتى بدون تسجيل دخول — بلا اسم أو رقم جوال (سوق الطلبات، بنمط dealapp.sa). */
export type PublicMarketRequest = {
  id: string;
  createdAt: string;
  purpose: ListingPurpose;
  unitType: string | null;
  city: string | null;
  district: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  notes: string | null;
};

/** ما يضيفه الموظف المسجَّل فوق النسخة العامة: بيانات التواصل. */
export type StaffMarketRequest = PublicMarketRequest & {
  fullName: string;
  phone: string;
};

type PublicRow = {
  id: string | null;
  created_at: string | null;
  purpose: string | null;
  unit_type: string | null;
  city: string | null;
  district: string | null;
  budget_min: number | null;
  budget_max: number | null;
  notes: string | null;
};

export function toPublicMarketRequest(row: PublicRow): PublicMarketRequest | null {
  if (!row.id) return null;
  return {
    id: row.id,
    createdAt: row.created_at ?? new Date(0).toISOString(),
    purpose: isPurpose(row.purpose) ? row.purpose : "rent",
    unitType: row.unit_type,
    city: row.city,
    district: row.district,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    notes: row.notes,
  };
}

/** «أبحث عن شقة للإيجار في حي الملقا» */
export function requestTitle(r: PublicMarketRequest): string {
  const label = r.purpose === "sale" ? "أبحث للشراء" : "أبحث للإيجار";
  const type = r.unitType ? `: ${r.unitType}` : "";
  const where = r.district ? ` في حي ${r.district}` : r.city ? ` في ${r.city}` : "";
  return `${label}${type}${where}`;
}

export function requestBudget(r: PublicMarketRequest): string | null {
  const suffix = r.purpose === "rent" ? " ر.س سنويًا" : " ر.س";
  if (r.budgetMin && r.budgetMax) {
    return `${r.budgetMin.toLocaleString("ar-SA")} – ${r.budgetMax.toLocaleString("ar-SA")}${suffix}`;
  }
  if (r.budgetMax) return `حتى ${r.budgetMax.toLocaleString("ar-SA")}${suffix}`;
  if (r.budgetMin) return `من ${r.budgetMin.toLocaleString("ar-SA")}${suffix}`;
  return null;
}

export function searchRequests(list: PublicMarketRequest[], text: string): PublicMarketRequest[] {
  const words = normalizeArabic(text).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((r) => {
    const hay = normalizeArabic(
      [r.unitType, r.city, r.district, r.notes].filter(Boolean).join(" "),
    );
    return words.every((w) => hay.includes(w));
  });
}
