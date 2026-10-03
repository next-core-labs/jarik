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
