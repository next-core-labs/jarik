/**
 * أثاث الوحدة: مستوى التأثيث وقائمة القطع بكمياتها (units.furnishing / units.furniture).
 *
 * The catalogue is what the pickers offer, grouped by room the way a landlord walks the unit; an
 * office or owner can still add an item by its own name — nothing in the column constrains it.
 */
export type Furnishing = "none" | "partial" | "full";

export type FurnitureItem = { name: string; qty: number };

export const FURNISHING_OPTIONS: Furnishing[] = ["none", "partial", "full"];

export const FURNISHING_LABEL: Record<Furnishing, string> = {
  none: "غير مؤثثة",
  partial: "مؤثثة جزئيًا",
  full: "مؤثثة بالكامل",
};

export const FURNITURE_CATALOGUE: { room: string; items: string[] }[] = [
  {
    room: "غرف النوم",
    items: ["سرير مفرد", "سرير مزدوج", "دولاب ملابس", "تسريحة", "كومودينو", "مرتبة"],
  },
  {
    room: "الصالة والمجلس",
    items: [
      "كنب",
      "جلسة عربية",
      "طاولة وسط",
      "طاولة طعام",
      "كراسي طعام",
      "تلفزيون",
      "سجاد",
      "ستائر",
    ],
  },
  {
    room: "المطبخ",
    items: ["مطبخ راكب", "ثلاجة", "فريزر", "فرن", "موقد غاز", "مايكروويف", "غسالة صحون", "شفاط"],
  },
  {
    room: "الأجهزة والتكييف",
    items: [
      "مكيف سبليت",
      "مكيف شباك",
      "مكيف مركزي",
      "غسالة ملابس",
      "نشافة",
      "سخان ماء",
      "مكنسة كهربائية",
    ],
  },
  {
    room: "دورات المياه",
    items: ["مرآة", "خزانة حمام", "دش مطري", "بانيو"],
  },
  {
    room: "أخرى",
    items: ["مكتب وكرسي", "رفوف", "إنارة", "إنترنت (راوتر)"],
  },
];

export function isFurnishing(v: unknown): v is Furnishing {
  return v === "none" || v === "partial" || v === "full";
}

/** Reads units.furniture defensively: anything that is not a {name, qty ≥ 1} item is dropped. */
export function parseFurniture(raw: unknown): FurnitureItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FurnitureItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const name = String((it as { name?: unknown }).name ?? "").trim();
    const qty = Math.floor(Number((it as { qty?: unknown }).qty ?? 1));
    if (!name) continue;
    out.push({ name, qty: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 99) : 1 });
  }
  return out;
}

/** «مكيف سبليت ×3، ثلاجة، …» — the short line a card or listing shows. */
export function furnitureSummary(items: FurnitureItem[], max = 6): string {
  const shown = items.slice(0, max).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name));
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join("، ")} و${rest} أخرى` : shown.join("، ");
}
