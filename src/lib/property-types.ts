/**
 * أنواع العقارات في السوق السعودي، مجموعة كما يفكر بها الباحث.
 *
 * An office may still type its own wording on a unit — nothing here constrains the column — but
 * these are what the pickers offer and what the market falls back to when nothing is listed yet.
 */
export const PROPERTY_TYPE_GROUPS: { group: string; types: string[] }[] = [
  {
    group: "سكني",
    types: ["شقة", "فيلا", "دور", "قصر", "دوبلكس", "استوديو", "عمارة سكنية", "غرفة"],
  },
  {
    group: "تجاري",
    types: ["محل تجاري", "مكتب", "معرض", "مستودع", "مصنع", "عمارة تجارية", "برج", "فندق"],
  },
  {
    group: "أراضٍ ومزارع",
    types: ["أرض سكنية", "أرض تجارية", "أرض زراعية", "مزرعة", "أرض صناعية"],
  },
  {
    group: "ترفيهي",
    types: ["استراحة", "شاليه", "مخيم"],
  },
];

export const PROPERTY_TYPES: string[] = PROPERTY_TYPE_GROUPS.flatMap((g) => g.types);

/** properties.structure: one standalone unit, or a building of several units. */
export type PropertyStructure = "single" | "building";

/** What a multi-unit property is (properties.building_type). */
export const BUILDING_TYPES: string[] = [
  "عمارة سكنية",
  "عمارة تجارية",
  "عمارة سكنية تجارية",
  "برج سكني",
  "برج تجاري",
  "مجمع سكني",
  "مجمع تجاري",
];

/** A standalone unit is any type except the buildings themselves (those are BUILDING_TYPES). */
const BUILDING_WORDS = new Set(["عمارة سكنية", "عمارة تجارية", "برج", "فندق"]);
export const SINGLE_UNIT_TYPE_GROUPS: { group: string; types: string[] }[] =
  PROPERTY_TYPE_GROUPS.map((g) => ({
    group: g.group,
    types: g.types.filter((t) => !BUILDING_WORDS.has(t)),
  })).filter((g) => g.types.length > 0);

/** The broad class (properties.property_type) of a unit or building type. */
export function groupOfType(type: string): string {
  if (type.includes("تجاري")) return "تجاري";
  return PROPERTY_TYPE_GROUPS.find((g) => g.types.includes(type))?.group ?? "سكني";
}

/** ماذا يريد المعلن أو الباحث: إيجار أم بيع. */
export type ListingPurpose = "rent" | "sale";

export const PURPOSE_LABEL: Record<ListingPurpose, string> = {
  rent: "للإيجار",
  sale: "للبيع",
};

/** «سنويًا» بعد سعر الإيجار؛ البيع سعر واحد بلا مدة. */
export const PRICE_SUFFIX: Record<ListingPurpose, string | null> = {
  rent: "/ سنويًا",
  sale: null,
};

export function isPurpose(value: unknown): value is ListingPurpose {
  return value === "rent" || value === "sale";
}
