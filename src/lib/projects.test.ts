import { describe, expect, it } from "vitest";

import {
  defaultProjectFilters,
  deliveryLabel,
  filterProjects,
  isProjectStatus,
  projectCities,
  sortProjects,
  statusLabel,
  toProject,
  toProjectModel,
  type Project,
  type ProjectModelRow,
  type ProjectRow,
} from "./projects";

const row = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "مجمع الياسمين",
  developer_name: "شركة التطوير",
  city: "الرياض",
  district: "الياسمين",
  lat: 24.81,
  lng: 46.63,
  description: "وصف",
  status: "off_plan",
  completion_pct: 35,
  delivery_year: 2028,
  delivery_quarter: 2,
  wafi_license_no: "7200000000",
  total_units: 120,
  amenities: ["مصعد"],
  featured: false,
  published_at: "2026-11-18T00:00:00Z",
  created_at: "2026-11-18T00:00:00Z",
  office_id: "22222222-2222-4222-8222-222222222222",
  company_name: "مكتب الرياض",
  logo_url: null,
  fal_license_no: "1100000000",
  office_phone: "0500000000",
  whatsapp_number: null,
  models_count: 3,
  price_from: 900000,
  available_units: 40,
  cover_path: null,
  photos_count: 0,
  ...over,
});

const project = (over: Partial<Project> = {}): Project => ({ ...toProject(row())!, ...over });

describe("toProject", () => {
  it("normalises a published row", () => {
    const p = toProject(row())!;
    expect(p.name).toBe("مجمع الياسمين");
    expect(p.status).toBe("off_plan");
    expect(p.priceFrom).toBe(900000);
    expect(p.availableUnits).toBe(40);
    expect(p.office.whatsapp).toBe("0500000000"); // يرجع لهاتف المكتب حين لا واتساب
  });

  it("drops a row the view could not fill", () => {
    expect(toProject(row({ id: null }))).toBeNull();
    expect(toProject(row({ name: null }))).toBeNull();
  });

  it("falls back to «على الخارطة» for an unknown stage, never crashes", () => {
    expect(toProject(row({ status: "something_new" }))!.status).toBe("off_plan");
    expect(isProjectStatus("ready")).toBe(true);
    expect(isProjectStatus("nope")).toBe(false);
  });

  it("treats missing numbers as zero, not NaN", () => {
    const p = toProject(row({ price_from: null, models_count: null, available_units: null }))!;
    expect(p.priceFrom).toBe(0);
    expect(p.modelsCount).toBe(0);
    expect(p.availableUnits).toBe(0);
  });
});

describe("toProjectModel", () => {
  const m = (over: Partial<ProjectModelRow> = {}): ProjectModelRow => ({
    id: "33333333-3333-4333-8333-333333333333",
    project_id: "11111111-1111-4111-8111-111111111111",
    name: "نموذج أ",
    unit_type: "شقة",
    area: 140,
    rooms: 3,
    halls: 1,
    bathrooms: 2,
    price: 900000,
    units_count: 20,
    available_count: 8,
    floor_plan_path: null,
    position: 1,
    ...over,
  });

  it("reads a model row", () => {
    const model = toProjectModel(m())!;
    expect(model.name).toBe("نموذج أ");
    expect(model.price).toBe(900000);
    expect(model.availableCount).toBe(8);
  });

  it("drops a nameless model", () => {
    expect(toProjectModel(m({ name: null }))).toBeNull();
  });
});

describe("deliveryLabel", () => {
  it("speaks in quarters, the way the market does", () => {
    expect(deliveryLabel(project())).toBe("الربع الثاني 2028");
    expect(deliveryLabel(project(), "en")).toBe("Q2 2028");
  });

  it("says a ready project is ready, whatever its stored date", () => {
    expect(deliveryLabel(project({ status: "ready" }))).toBe("جاهز للتسليم الآن");
  });

  it("stays silent when no quarter was set", () => {
    expect(deliveryLabel(project({ deliveryYear: null }))).toBeNull();
    expect(deliveryLabel(project({ deliveryQuarter: null }))).toBeNull();
  });
});

describe("statusLabel", () => {
  it("labels every stage in both languages", () => {
    expect(statusLabel("off_plan")).toBe("على الخارطة");
    expect(statusLabel("under_construction")).toBe("تحت الإنشاء");
    expect(statusLabel("ready", "en")).toBe("Ready to move");
  });
});

describe("filterProjects", () => {
  const list = [
    project({
      id: "a",
      name: "مجمع الياسمين",
      city: "الرياض",
      status: "off_plan",
      priceFrom: 900000,
    }),
    project({ id: "b", name: "برج جدة", city: "جدة", status: "ready", priceFrom: 2_500_000 }),
    project({
      id: "c",
      name: "أبراج النرجس",
      city: "الرياض",
      status: "under_construction",
      priceFrom: 1_400_000,
      district: "النرجس",
    }),
  ];
  const ids = (f: Parameters<typeof filterProjects>[1]) => filterProjects(list, f).map((p) => p.id);

  it("returns everything by default", () => {
    expect(ids(defaultProjectFilters)).toEqual(["a", "b", "c"]);
  });

  it("filters by city and stage", () => {
    expect(ids({ ...defaultProjectFilters, city: "الرياض" })).toEqual(["a", "c"]);
    expect(ids({ ...defaultProjectFilters, status: "ready" })).toEqual(["b"]);
  });

  it("caps on the starting price", () => {
    expect(ids({ ...defaultProjectFilters, maxPriceFrom: 1_500_000 })).toEqual(["a", "c"]);
  });

  it("hides a project with no priced model when a price cap is set", () => {
    const unpriced = [project({ id: "x", priceFrom: 0 })];
    expect(filterProjects(unpriced, { ...defaultProjectFilters, maxPriceFrom: 5_000_000 })).toEqual(
      [],
    );
  });

  it("searches name, district and city with Arabic normalisation", () => {
    // «النرجس» بألف همزة مختلفة وتاء مربوطة ليست هنا — المهم أن التطبيع لا يمنع المطابقة.
    expect(ids({ ...defaultProjectFilters, text: "النرجس" })).toEqual(["c"]);
    expect(ids({ ...defaultProjectFilters, text: "جده" })).toEqual(["b"]);
    expect(ids({ ...defaultProjectFilters, text: "لا يوجد" })).toEqual([]);
  });
});

describe("sortProjects", () => {
  const list = [
    project({ id: "a", priceFrom: 900000, completionPct: 20, publishedAt: "2026-11-01T00:00:00Z" }),
    project({
      id: "b",
      priceFrom: 2_500_000,
      completionPct: 80,
      publishedAt: "2026-11-10T00:00:00Z",
    }),
  ];

  it("sorts by price and by completion", () => {
    expect(sortProjects(list, "price-asc").map((p) => p.id)).toEqual(["a", "b"]);
    expect(sortProjects(list, "price-desc").map((p) => p.id)).toEqual(["b", "a"]);
    expect(sortProjects(list, "completion-desc").map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("floats a featured project to the top of the default view only", () => {
    const withFeatured = [
      ...list,
      project({ id: "old-featured", featured: true, publishedAt: "2026-01-01T00:00:00Z" }),
    ];
    expect(sortProjects(withFeatured, "newest")[0]!.id).toBe("old-featured");
    // الفرز الصريح بالسعر يعرض ما طُلب بالضبط — التمييز لا يتجاوز الصف.
    expect(sortProjects(withFeatured, "price-asc")[0]!.id).not.toBe("old-featured");
  });
});

describe("projectCities", () => {
  it("lists each city once, sorted, ignoring blanks", () => {
    expect(
      projectCities([
        project({ city: "جدة" }),
        project({ city: "الرياض" }),
        project({ city: "الرياض" }),
        project({ city: null }),
      ]),
    ).toEqual(["الرياض", "جدة"]);
  });
});

describe("floor plan path contract", () => {
  // العقد مع القاعدة: قيد project_models_plan_in_project_folder يشترط أن يبدأ مسار المخطط بـ
  // «projects/<project id>/» — نفس مجلّد صور المشروع. المخطط يُحفظ هناك لا في مجلّد خاص به، فلو
  // تغيّر هذا يرفض الجدول الصف وتُرفض السياسة الرفع.
  const projectId = "11111111-1111-4111-8111-111111111111";

  it("reads a plan path the view returned", () => {
    const m = toProjectModel({
      id: "33333333-3333-4333-8333-333333333333",
      project_id: projectId,
      name: "نموذج أ",
      unit_type: "شقة",
      area: 140,
      rooms: 3,
      halls: 1,
      bathrooms: 2,
      price: 900000,
      units_count: 20,
      available_count: 8,
      floor_plan_path: `projects/${projectId}/plan.jpg`,
      position: 1,
    })!;
    expect(m.floorPlanPath).toBe(`projects/${projectId}/plan.jpg`);
    expect(m.floorPlanPath!.startsWith(`projects/${projectId}/`)).toBe(true);
  });

  it("treats a model with no plan as null, not an empty string", () => {
    const m = toProjectModel({
      id: "44444444-4444-4444-8444-444444444444",
      project_id: projectId,
      name: "نموذج ب",
      unit_type: "شقة",
      area: null,
      rooms: null,
      halls: null,
      bathrooms: null,
      price: 750000,
      units_count: null,
      available_count: null,
      floor_plan_path: null,
      position: 2,
    })!;
    expect(m.floorPlanPath).toBeNull();
  });
});
