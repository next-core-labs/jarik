import { describe, expect, it } from "vitest";

import {
  defaultFilters,
  filterListings,
  listingLocation,
  listingTitle,
  normalizeArabic,
  phoneHref,
  priceDropPct,
  similarListings,
  sortListings,
  toInternational,
  toListing,
  whatsappHref,
  type Listing,
  type ListingRow,
} from "./market";

const row = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: "u1",
  unit_number: "12",
  unit_name: null,
  unit_type: "سكني",
  district: "النرجس",
  street: null,
  floor_no: null,
  rooms: 3,
  halls: 1,
  bathrooms: 2,
  area: 120,
  annual_rent: 40000,
  furnished: false,
  furnishing: "none",
  furniture: [],
  company_name: "مكتب جارك",
  logo_url: null,
  fal_license_no: "1200012345",
  office_phone: "0500000000",
  whatsapp_number: null,
  office_city: "الرياض",
  office_district: "الملقا",
  listing_description: null,
  featured: null,
  list_price: null,
  amenities: [],
  created_at: "2026-09-01T10:00:00Z",
  cover_path: null,
  photos_count: 0,
  office_id: "o1",
  listing_purpose: "rent",
  sale_price: 0,
  owner_page_id: null,
  owner_name: null,
  owner_avatar_path: null,
  contact_phone: null,
  contact_whatsapp: null,
  lat: null,
  lng: null,
  ...over,
});

const L = (over: Partial<ListingRow> = {}): Listing => toListing(row(over))!;

describe("toListing", () => {
  it("drops rows without an id and normalises nulls", () => {
    expect(toListing(row({ id: null }))).toBeNull();
    const l = L({ halls: null, bathrooms: null, amenities: null, photos_count: null });
    expect(l.halls).toBe(0);
    expect(l.bathrooms).toBe(0);
    expect(l.amenities).toEqual([]);
    expect(l.photosCount).toBe(0);
  });

  it("uses the owner's contact when there is one, else the office's", () => {
    expect(L().contactPhone).toBe("0500000000");
    expect(L({ contact_phone: "0555555555" }).contactPhone).toBe("0555555555");
    expect(L({ whatsapp_number: "0566666666" }).contactWhatsapp).toBe("0566666666");
    expect(L().contactWhatsapp).toBe("0500000000");
  });

  it("attaches the owner only when a published owner page exists", () => {
    expect(L().owner).toBeNull();
    expect(L({ owner_page_id: "own1", owner_name: "عبدالله" }).owner).toEqual({
      id: "own1",
      name: "عبدالله",
      avatarPath: null,
    });
  });
});

describe("normalizeArabic", () => {
  it("unifies letter variants, strips diacritics and converts Arabic digits", () => {
    expect(normalizeArabic("الأندلس")).toBe(normalizeArabic("الاندلس"));
    expect(normalizeArabic("مدرسة")).toBe(normalizeArabic("مدرسه"));
    expect(normalizeArabic("مُحَمَّد")).toBe("محمد");
    expect(normalizeArabic("غرفة ٣")).toBe("غرفه 3");
  });
});

describe("filterListings", () => {
  const list = [
    L({ id: "a", district: "النرجس", rooms: 2, annual_rent: 30000, furnished: true }),
    L({ id: "b", district: "الياسمين", rooms: 4, annual_rent: 60000, unit_type: "تجاري" }),
    L({ id: "c", district: "الأندلس", rooms: 3, annual_rent: 45000, company_name: "مكتب الراجحي" }),
  ];
  const ids = (l: Listing[]) => l.map((x) => x.id);

  it("returns everything with the default filters", () => {
    expect(ids(filterListings(list, defaultFilters))).toEqual(["a", "b", "c"]);
  });

  it("searches district, office name and unit type, ignoring alef/ta-marbuta variants", () => {
    expect(ids(filterListings(list, { ...defaultFilters, text: "الاندلس" }))).toEqual(["c"]);
    expect(ids(filterListings(list, { ...defaultFilters, text: "راجحي" }))).toEqual(["c"]);
    expect(ids(filterListings(list, { ...defaultFilters, text: "تجاري" }))).toEqual(["b"]);
    expect(ids(filterListings(list, { ...defaultFilters, text: "نرجس جارك" }))).toEqual(["a"]);
  });

  it("filters by type, rooms, furnishing and maximum rent", () => {
    expect(ids(filterListings(list, { ...defaultFilters, unitType: "تجاري" }))).toEqual(["b"]);
    expect(ids(filterListings(list, { ...defaultFilters, minRooms: 3 }))).toEqual(["b", "c"]);
    expect(ids(filterListings(list, { ...defaultFilters, furnished: "yes" }))).toEqual(["a"]);
    expect(ids(filterListings(list, { ...defaultFilters, furnished: "no" }))).toEqual(["b", "c"]);
    expect(ids(filterListings(list, { ...defaultFilters, maxPrice: 45000 }))).toEqual(["a", "c"]);
  });

  it("combines filters", () => {
    expect(ids(filterListings(list, { ...defaultFilters, minRooms: 3, maxPrice: 50000 }))).toEqual([
      "c",
    ]);
  });
});

describe("sortListings", () => {
  const list = [
    L({ id: "old", created_at: "2026-01-01T00:00:00Z", annual_rent: 50000, area: 90 }),
    L({ id: "new", created_at: "2026-09-01T00:00:00Z", annual_rent: 30000, area: 150 }),
    L({ id: "none", created_at: null, annual_rent: 40000, area: null }),
  ];
  const ids = (l: Listing[]) => l.map((x) => x.id);

  it("orders by newest, price and area without mutating the input", () => {
    const before = ids(list);
    expect(ids(sortListings(list, "newest"))).toEqual(["new", "old", "none"]);
    expect(ids(sortListings(list, "price-asc"))).toEqual(["new", "none", "old"]);
    expect(ids(sortListings(list, "price-desc"))).toEqual(["old", "none", "new"]);
    expect(ids(sortListings(list, "area-desc"))).toEqual(["new", "old", "none"]);
    expect(ids(list)).toEqual(before);
  });

  it("floats featured offers to the top of the default (newest) view only", () => {
    const featuredButOld: Listing = { ...list[0]!, id: "featured-old", featured: true };
    const withFeatured = [...list, featuredButOld];

    expect(ids(sortListings(withFeatured, "newest"))).toEqual([
      "featured-old",
      "new",
      "old",
      "none",
    ]);
    // An explicit price/area sort reflects exactly what was asked — featured doesn't jump the queue.
    expect(ids(sortListings(withFeatured, "price-asc"))).toEqual([
      "new",
      "none",
      "old",
      "featured-old",
    ]);
  });
});

describe("titles and similar offers", () => {
  it("builds the title and the location line", () => {
    expect(listingTitle(L())).toBe("سكني رقم 12 للإيجار في حي النرجس");
    expect(listingTitle(L({ unit_name: "الياسمين", district: null }))).toBe(
      "سكني «الياسمين» للإيجار",
    );
    expect(listingLocation(L({ street: "شارع الأمير" }))).toBe("حي النرجس · شارع الأمير · الرياض");
  });

  it("prefers the same district, then the same type, never the offer itself", () => {
    const cur = L({ id: "cur", district: "النرجس", unit_type: "سكني" });
    const all = [
      cur,
      L({ id: "sameDistrict", district: "النرجس", unit_type: "تجاري" }),
      L({ id: "sameBoth", district: "النرجس", unit_type: "سكني" }),
      L({ id: "sameType", district: "الياسمين", unit_type: "سكني" }),
      L({ id: "unrelated", district: "الياسمين", unit_type: "مستودع" }),
    ];
    expect(similarListings(all, cur, 3).map((l) => l.id)).toEqual([
      "sameBoth",
      "sameDistrict",
      "sameType",
    ]);
    expect(similarListings(all, cur, 1).map((l) => l.id)).toEqual(["sameBoth"]);
  });
});

describe("phone links", () => {
  it("adds the Saudi country code to local numbers", () => {
    expect(toInternational("0501234567")).toBe("966501234567");
    expect(toInternational("501234567")).toBe("966501234567");
    expect(toInternational("+966 50 123 4567")).toBe("966501234567");
    expect(toInternational("00966501234567")).toBe("966501234567");
    expect(toInternational("")).toBeNull();
    expect(toInternational(null)).toBeNull();
  });

  it("builds tel: and WhatsApp links, with an optional message", () => {
    expect(phoneHref("0501234567")).toBe("tel:+966501234567");
    expect(phoneHref(null)).toBeNull();
    expect(whatsappHref("0501234567")).toBe("https://wa.me/966501234567");
    expect(whatsappHref("0501234567", "مرحبا")).toBe(
      `https://wa.me/966501234567?text=${encodeURIComponent("مرحبا")}`,
    );
  });
});

describe("priceDropPct", () => {
  it("is the whole-percent cut from the original asking price", () => {
    expect(priceDropPct(L({ annual_rent: 48000, list_price: 50000 }))).toBe(4);
    expect(
      priceDropPct(L({ listing_purpose: "sale", sale_price: 2_300_000, list_price: 2_400_000 })),
    ).toBe(4);
  });

  it("is null without an earlier, higher price", () => {
    expect(priceDropPct(L({ annual_rent: 50000, list_price: null }))).toBeNull();
    expect(priceDropPct(L({ annual_rent: 50000, list_price: 50000 }))).toBeNull();
    expect(priceDropPct(L({ annual_rent: 50000, list_price: 50100 }))).toBeNull(); // < 1%
  });
});
