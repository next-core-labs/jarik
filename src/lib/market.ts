import type { Database } from "@/integrations/supabase/types";
import { isPurpose, PURPOSE_LABEL, type ListingPurpose } from "@/lib/property-types";
import { isFurnishing, parseFurniture, type Furnishing, type FurnitureItem } from "@/lib/furniture";

export type ListingRow = Database["public"]["Views"]["vacant_units_public"]["Row"];

/** One offer on the market, normalised from the public view (whose columns are all nullable). */
export type Listing = {
  id: string;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  district: string | null;
  street: string | null;
  floorNo: string | null;
  rooms: number | null;
  halls: number;
  bathrooms: number;
  area: number | null;
  /** إيجار سنوي للعروض المؤجَّرة، و0 لعروض البيع. */
  annualRent: number;
  /** سعر البيع لعروض البيع، و0 لغيرها. */
  salePrice: number;
  /** The asking price before the automatic vacant-price cuts — set only while the current price is
   *  really below it (the view returns null otherwise). */
  listPrice: number | null;
  purpose: ListingPurpose;
  furnished: boolean;
  furnishing: Furnishing;
  /** What the furnished unit comes with (item names are as the office typed them, in Arabic). */
  furniture: FurnitureItem[];
  description: string | null;
  amenities: string[];
  createdAt: string | null;
  /** يميَّز بيدوي من لوحة المدير العام (/hq) — يظهر أولًا بالفرز الافتراضي بالسوق العام. */
  featured: boolean;
  coverPath: string | null;
  photosCount: number;
  /** إحداثية تقريبية (منزلتان عشريتان) لعرض خريطة الحي وأقرب الخدمات — null لو العقار بلا موقع. */
  lat: number | null;
  lng: number | null;
  office: {
    id: string | null;
    name: string;
    logoPath: string | null;
    licenseNo: string | null;
    city: string | null;
    district: string | null;
  };
  /** The owner's page, when the office has published one for this unit's owner. */
  owner: { id: string; name: string; avatarPath: string | null } | null;
  contactPhone: string | null;
  contactWhatsapp: string | null;
};

export function toListing(row: ListingRow): Listing | null {
  if (!row.id) return null;
  return {
    id: row.id,
    unitNumber: row.unit_number ?? "",
    unitName: row.unit_name,
    unitType: row.unit_type ?? "",
    district: row.district,
    street: row.street,
    floorNo: row.floor_no,
    rooms: row.rooms,
    halls: row.halls ?? 0,
    bathrooms: row.bathrooms ?? 0,
    area: row.area,
    annualRent: Number(row.annual_rent ?? 0),
    salePrice: Number(row.sale_price ?? 0),
    listPrice: row.list_price != null ? Number(row.list_price) : null,
    purpose: isPurpose(row.listing_purpose) ? row.listing_purpose : "rent",
    furnished: Boolean(row.furnished),
    furnishing: isFurnishing(row.furnishing) ? row.furnishing : row.furnished ? "full" : "none",
    furniture: parseFurniture(row.furniture),
    description: row.listing_description,
    amenities: row.amenities ?? [],
    createdAt: row.created_at,
    featured: Boolean(row.featured),
    coverPath: row.cover_path,
    photosCount: row.photos_count ?? 0,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    office: {
      id: row.office_id,
      name: row.company_name ?? "",
      logoPath: row.logo_url,
      licenseNo: row.fal_license_no,
      city: row.office_city,
      district: row.office_district,
    },
    owner: row.owner_page_id
      ? {
          id: row.owner_page_id,
          name: row.owner_name ?? "",
          avatarPath: row.owner_avatar_path,
        }
      : null,
    contactPhone: row.contact_phone ?? row.office_phone,
    contactWhatsapp: row.contact_whatsapp ?? row.whatsapp_number ?? row.office_phone,
  };
}

/** The number this offer is judged by: the asking price when it is for sale, else the annual rent. */
export function listingPrice(l: Listing): number {
  return l.purpose === "sale" ? l.salePrice : l.annualRent;
}

/** Whole-percent drop from the original asking price (≥1), or null when there is none. */
export function priceDropPct(l: Listing): number | null {
  const now = listingPrice(l);
  if (!l.listPrice || now <= 0 || l.listPrice <= now) return null;
  const pct = Math.round(((l.listPrice - now) / l.listPrice) * 100);
  return pct >= 1 ? pct : null;
}

/** Lower-case, unify Arabic letter variants and strip diacritics, so "الأندلس" finds "الاندلس". */
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

export type SortKey = "newest" | "price-asc" | "price-desc" | "area-desc";

export type MarketFilters = {
  text: string;
  /** "all" = rentals and sales together. */
  purpose: ListingPurpose | "all";
  unitType: string; // "" = any
  minRooms: number; // 0 = any
  furnished: "all" | "yes" | "no";
  /** Ceiling on the offer's own price: the rent for a rental, the asking price for a sale. */
  maxPrice: number | null;
  sort: SortKey;
};

export const defaultFilters: MarketFilters = {
  text: "",
  purpose: "all",
  unitType: "",
  minRooms: 0,
  furnished: "all",
  maxPrice: null,
  sort: "newest",
};

function searchText(l: Listing): string {
  return normalizeArabic(
    [
      l.district,
      l.street,
      l.unitName,
      l.unitNumber,
      l.unitType,
      l.office.name,
      l.office.city,
      l.office.district,
      l.owner?.name,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function filterListings(list: Listing[], f: MarketFilters): Listing[] {
  const words = normalizeArabic(f.text).split(/\s+/).filter(Boolean);
  return list.filter((l) => {
    if (f.purpose !== "all" && l.purpose !== f.purpose) return false;
    if (f.unitType && l.unitType !== f.unitType) return false;
    if (f.minRooms > 0 && (l.rooms ?? 0) < f.minRooms) return false;
    if (f.furnished === "yes" && !l.furnished) return false;
    if (f.furnished === "no" && l.furnished) return false;
    if (f.maxPrice !== null && listingPrice(l) > f.maxPrice) return false;
    if (words.length > 0) {
      const hay = searchText(l);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function sortListings(list: Listing[], sort: SortKey): Listing[] {
  const copy = [...list];
  const time = (l: Listing) => (l.createdAt ? Date.parse(l.createdAt) : 0);
  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => listingPrice(a) - listingPrice(b));
    case "price-desc":
      return copy.sort((a, b) => listingPrice(b) - listingPrice(a));
    case "area-desc":
      return copy.sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
    default:
      // Featured offers float to the top of the default ("newest") view only — an explicit
      // price/area sort should reflect exactly what the visitor asked for, not be reordered by it.
      return copy.sort((a, b) => Number(b.featured) - Number(a.featured) || time(b) - time(a));
  }
}

/** «شقة «الياسمين» للإيجار في حي النرجس» — أو «أرض سكنية رقم 12 للبيع في حي الملقا». */
export function listingTitle(l: Listing): string {
  const name = l.unitName ? `«${l.unitName}»` : `رقم ${l.unitNumber}`;
  return `${l.unitType} ${name} ${PURPOSE_LABEL[l.purpose]}${l.district ? ` في حي ${l.district}` : ""}`;
}

export function listingLocation(l: Listing): string {
  return [l.district ? `حي ${l.district}` : null, l.street, l.office.city]
    .filter(Boolean)
    .join(" · ");
}

/** Up to `limit` other offers, preferring the same district, then the same type. */
export function similarListings(all: Listing[], current: Listing, limit = 3): Listing[] {
  const others = all.filter((l) => l.id !== current.id);
  const score = (l: Listing) =>
    (l.purpose === current.purpose ? 4 : 0) +
    (current.district && l.district === current.district ? 2 : 0) +
    (l.unitType === current.unitType ? 1 : 0);
  return others
    .filter((l) => l.purpose === current.purpose)
    .map((l) => ({ l, s: score(l) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.l);
}

/** Digits only, Saudi country code added. Returns null when there is nothing dialable. */
export function toInternational(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("966")) return d;
  if (d.startsWith("00966")) return d.slice(2);
  if (d.startsWith("0")) return `966${d.slice(1)}`;
  return `966${d}`;
}

export function phoneHref(phone: string | null | undefined): string | null {
  const intl = toInternational(phone);
  return intl ? `tel:+${intl}` : null;
}

export function whatsappHref(phone: string | null | undefined, text?: string): string | null {
  const intl = toInternational(phone);
  if (!intl) return null;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
