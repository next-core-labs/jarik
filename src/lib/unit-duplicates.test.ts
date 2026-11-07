import { describe, expect, it } from "vitest";

import { deedFormatError, normalizeDeed, normalizeUnitNumber } from "./unit-duplicates";

describe("normalizeDeed", () => {
  it("keeps the digits only, in Latin", () => {
    expect(normalizeDeed("٣١٠ ١١٧-٠١")).toBe("31011701");
    expect(normalizeDeed("۳۱۰/117")).toBe("310117");
    expect(normalizeDeed(" 310117 ")).toBe("310117");
  });

  it("is empty for no deed", () => {
    expect(normalizeDeed(null)).toBe("");
    expect(normalizeDeed("  ")).toBe("");
  });
});

describe("deedFormatError", () => {
  it("accepts digits grouped by spaces, slashes or dashes", () => {
    expect(deedFormatError("")).toBeNull();
    expect(deedFormatError("310117012345")).toBeNull();
    expect(deedFormatError("٣١٠ ١١٧/٠١-٢")).toBeNull();
  });

  it("rejects letters and separators alone", () => {
    expect(deedFormatError("صك 3101")).toBe("رقم الصك أرقام فقط");
    expect(deedFormatError("--")).toBe("رقم الصك أرقام فقط");
  });
});

describe("normalizeUnitNumber", () => {
  it("treats Arabic digits, spacing and case alike", () => {
    expect(normalizeUnitNumber(" ١٠١ ")).toBe("101");
    expect(normalizeUnitNumber("A  12")).toBe(normalizeUnitNumber("a 12"));
  });
});
