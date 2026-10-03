import { describe, expect, it } from "vitest";
import { classifyMaintenancePriority, isUrgentMaintenanceText } from "@/lib/maintenance-triage";

describe("isUrgentMaintenanceText", () => {
  it("flags a water leak", () => {
    expect(isUrgentMaintenanceText("فيه تسرب مياه من السقف")).toBe(true);
  });

  it("flags an electrical hazard", () => {
    expect(isUrgentMaintenanceText("صار ماس كهربائي بالمطبخ")).toBe(true);
  });

  it("flags a gas smell", () => {
    expect(isUrgentMaintenanceText("أشم رائحة غاز بالمطبخ")).toBe(true);
  });

  it("does not flag routine maintenance", () => {
    expect(isUrgentMaintenanceText("الباب يصدر صوتًا عند الفتح")).toBe(false);
  });
});

describe("classifyMaintenancePriority", () => {
  it("overrides a low priority to urgent when the title mentions a fire", () => {
    expect(classifyMaintenancePriority("حريق بالمكيف", null, "low")).toBe("urgent");
  });

  it("overrides based on the description when the title is generic", () => {
    expect(classifyMaintenancePriority("مشكلة بالمطبخ", "فيه تسرب مياه تحت الحوض", "low")).toBe(
      "urgent",
    );
  });

  it("keeps the requested priority for routine issues", () => {
    expect(classifyMaintenancePriority("الباب يصر", "يحتاج تزييت المفصلات", "low")).toBe("low");
  });

  it("defaults to medium when no priority is requested", () => {
    expect(classifyMaintenancePriority("الباب يصر", null)).toBe("medium");
  });
});
