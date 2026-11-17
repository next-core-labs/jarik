import type { Database } from "@/integrations/supabase/types";
import type { Locale } from "@/lib/i18n";

/**
 * المشاريع العقارية (البيع على الخارطة). المشروع ليس وحدة: مجمّع أو برج له نماذج وحدات ونسبة إنجاز
 * وربع تسليم، والمشتري يسجّل اهتمامًا بنموذج لا يستأجر وحدة. البيع على الخارطة يتطلب ترخيص «وافي»
 * من الهيئة العامة للعقار، والقاعدة تمنع نشر مشروع على الخارطة بلا رقمه (migration 20261118200000).
 */

export type ProjectRow = Database["public"]["Views"]["projects_public"]["Row"];
export type ProjectModelRow = Database["public"]["Views"]["project_models_public"]["Row"];

export type ProjectStatus = "off_plan" | "under_construction" | "ready";

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "off_plan",
  "under_construction",
  "ready",
];

const STATUS_LABEL: Record<ProjectStatus, Record<Locale, string>> = {
  off_plan: { ar: "على الخارطة", en: "Off-plan" },
  under_construction: { ar: "تحت الإنشاء", en: "Under construction" },
  ready: { ar: "جاهز للتسليم", en: "Ready to move" },
};

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);
}

export function statusLabel(status: ProjectStatus, locale: Locale = "ar"): string {
  return STATUS_LABEL[status][locale];
}

export type ProjectModel = {
  id: string;
  name: string;
  unitType: string;
  area: number | null;
  rooms: number | null;
  halls: number | null;
  bathrooms: number | null;
  price: number;
  unitsCount: number | null;
  availableCount: number | null;
  floorPlanPath: string | null;
  position: number;
};

export type Project = {
  id: string;
  name: string;
  developerName: string | null;
  city: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  status: ProjectStatus;
  completionPct: number;
  deliveryYear: number | null;
  deliveryQuarter: number | null;
  /** رقم ترخيص «وافي» — مضمون الوجود لمشروع منشور على الخارطة. */
  wafiLicenseNo: string | null;
  totalUnits: number | null;
  amenities: string[];
  featured: boolean;
  publishedAt: string | null;
  modelsCount: number;
  /** أقل سعر بين النماذج — «يبدأ من». 0 حين لا نموذج بسعر. */
  priceFrom: number;
  availableUnits: number;
  coverPath: string | null;
  photosCount: number;
  office: {
    id: string | null;
    name: string;
    logoPath: string | null;
    licenseNo: string | null;
    phone: string | null;
    whatsapp: string | null;
  };
};

export function toProject(row: ProjectRow): Project | null {
  if (!row.id || !row.name) return null;
  return {
    id: row.id,
    name: row.name,
    developerName: row.developer_name,
    city: row.city,
    district: row.district,
    lat: row.lat != null ? Number(row.lat) : null,
    lng: row.lng != null ? Number(row.lng) : null,
    description: row.description,
    status: isProjectStatus(row.status) ? row.status : "off_plan",
    completionPct: Number(row.completion_pct ?? 0),
    deliveryYear: row.delivery_year,
    deliveryQuarter: row.delivery_quarter,
    wafiLicenseNo: row.wafi_license_no,
    totalUnits: row.total_units,
    amenities: row.amenities ?? [],
    featured: Boolean(row.featured),
    publishedAt: row.published_at,
    modelsCount: Number(row.models_count ?? 0),
    priceFrom: Number(row.price_from ?? 0),
    availableUnits: Number(row.available_units ?? 0),
    coverPath: row.cover_path,
    photosCount: Number(row.photos_count ?? 0),
    office: {
      id: row.office_id,
      name: row.company_name ?? "",
      logoPath: row.logo_url,
      licenseNo: row.fal_license_no,
      phone: row.office_phone,
      whatsapp: row.whatsapp_number ?? row.office_phone,
    },
  };
}

export function toProjectModel(row: ProjectModelRow): ProjectModel | null {
  if (!row.id || !row.name) return null;
  return {
    id: row.id,
    name: row.name,
    unitType: row.unit_type ?? "شقة",
    area: row.area != null ? Number(row.area) : null,
    rooms: row.rooms,
    halls: row.halls,
    bathrooms: row.bathrooms,
    price: Number(row.price ?? 0),
    unitsCount: row.units_count,
    availableCount: row.available_count,
    floorPlanPath: row.floor_plan_path,
    position: Number(row.position ?? 0),
  };
}

/** «الربع الثاني 2028» — كما يتحدّث به السوق، لا تاريخًا بعينه. null لمشروع جاهز أو بلا موعد. */
export function deliveryLabel(p: Project, locale: Locale = "ar"): string | null {
  if (p.status === "ready") return locale === "en" ? "Ready now" : "جاهز للتسليم الآن";
  if (!p.deliveryYear || !p.deliveryQuarter) return null;
  if (locale === "en") return `Q${p.deliveryQuarter} ${p.deliveryYear}`;
  const names = ["الأول", "الثاني", "الثالث", "الرابع"];
  return `الربع ${names[p.deliveryQuarter - 1]} ${p.deliveryYear}`;
}

export type ProjectFilters = {
  text: string;
  city: string;
  status: ProjectStatus | "all";
  /** سقف «يبدأ من»: المشروع يُقبل إذا كان أقل أسعار نماذجه دون هذا الحد. */
  maxPriceFrom: number | null;
  sort: "newest" | "price-asc" | "price-desc" | "completion-desc";
};

export const defaultProjectFilters: ProjectFilters = {
  text: "",
  city: "",
  status: "all",
  maxPriceFrom: null,
  sort: "newest",
};

/** نفس تطبيع العربية في سوق العروض، ليتطابق سلوك البحث. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim();
}

function haystack(p: Project): string {
  return normalize(
    [p.name, p.developerName, p.city, p.district, p.office.name].filter(Boolean).join(" "),
  );
}

export function filterProjects(list: Project[], f: ProjectFilters): Project[] {
  const words = normalize(f.text).split(/\s+/).filter(Boolean);
  return list.filter((p) => {
    if (f.status !== "all" && p.status !== f.status) return false;
    if (f.city && p.city !== f.city) return false;
    if (f.maxPriceFrom !== null && (p.priceFrom === 0 || p.priceFrom > f.maxPriceFrom))
      return false;
    if (words.length > 0) {
      const hay = haystack(p);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function sortProjects(list: Project[], sort: ProjectFilters["sort"]): Project[] {
  const copy = [...list];
  const time = (p: Project) => (p.publishedAt ? Date.parse(p.publishedAt) : 0);
  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => a.priceFrom - b.priceFrom);
    case "price-desc":
      return copy.sort((a, b) => b.priceFrom - a.priceFrom);
    case "completion-desc":
      return copy.sort((a, b) => b.completionPct - a.completionPct);
    default:
      // المميَّز أولًا في الفرز الافتراضي وحده — كما في سوق العروض.
      return copy.sort((a, b) => Number(b.featured) - Number(a.featured) || time(b) - time(a));
  }
}

/** مدن المشاريع المنشورة، لقائمة الفلتر. */
export function projectCities(list: Project[]): string[] {
  return [...new Set(list.map((p) => p.city).filter((c): c is string => Boolean(c)))].sort((a, b) =>
    a.localeCompare(b, "ar"),
  );
}
