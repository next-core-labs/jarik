import { describe, expect, it } from "vitest";

import {
  digitsOnly,
  hasValidSaudiIdChecksum,
  idTypeOf,
  validateFalLicense,
  validateSaudiId,
} from "./saudi-id";

describe("digitsOnly", () => {
  it("accepts the Arabic-Indic digits a Saudi keyboard produces", () => {
    expect(digitsOnly("١٠٢٣٤٥٦٧٨٩")).toBe("1023456789");
  });

  it("strips spaces, dashes and anything else a person pastes in", () => {
    expect(digitsOnly("1023-456 789")).toBe("1023456789");
    expect(digitsOnly("05٠ 123 4567")).toBe("0501234567");
  });
});

describe("idTypeOf", () => {
  it("reads 1 as a national id and 2 as an iqama", () => {
    expect(idTypeOf("1023456789")).toBe("national");
    expect(idTypeOf("2023456789")).toBe("iqama");
  });

  it("rejects anything that is not ten digits starting with 1 or 2", () => {
    expect(idTypeOf("3023456789")).toBeNull();
    expect(idTypeOf("102345678")).toBeNull();
    expect(idTypeOf("10234567890")).toBeNull();
    expect(idTypeOf("")).toBeNull();
  });
});

describe("hasValidSaudiIdChecksum", () => {
  it("accepts numbers whose check digit is right", () => {
    expect(hasValidSaudiIdChecksum("1023456781")).toBe(true);
    expect(hasValidSaudiIdChecksum("1000000008")).toBe(true);
    expect(hasValidSaudiIdChecksum("2023456789")).toBe(true);
    expect(hasValidSaudiIdChecksum("2000000006")).toBe(true);
  });

  it("refuses a wrong check digit or a mistyped digit", () => {
    expect(hasValidSaudiIdChecksum("1000000000")).toBe(false);
    expect(hasValidSaudiIdChecksum("1023456789")).toBe(false);
    expect(hasValidSaudiIdChecksum("1023456718")).toBe(false);
    expect(hasValidSaudiIdChecksum("2023456788")).toBe(false);
  });

  it("refuses anything that is not ten Latin digits", () => {
    expect(hasValidSaudiIdChecksum("100000008")).toBe(false);
    expect(hasValidSaudiIdChecksum("10000000a8")).toBe(false);
  });
});

describe("validateSaudiId", () => {
  it("accepts a national id for every account type", () => {
    for (const t of ["office", "owner", "tenant"] as const) {
      expect(validateSaudiId("1023456781", t)).toBeNull();
    }
  });

  it("accepts Arabic-Indic digits with a valid check digit", () => {
    expect(validateSaudiId("١٠٢٣٤٥٦٧٨١", "owner")).toBeNull();
  });

  it("refuses a number whose check digit is wrong, naming the document", () => {
    expect(validateSaudiId("1000000000", "office")).toContain("رقم الهوية غير صحيح");
    expect(validateSaudiId("2023456788", "tenant")).toContain("رقم الإقامة غير صحيح");
  });

  it("accepts an iqama for an owner or a tenant", () => {
    expect(validateSaudiId("2023456789", "owner")).toBeNull();
    expect(validateSaudiId("2023456789", "tenant")).toBeNull();
  });

  it("refuses an iqama for an office, because an office is a Saudi business", () => {
    expect(validateSaudiId("2023456789", "office")).toContain("هوية وطنية");
  });

  it("explains the length and the leading digit separately", () => {
    expect(validateSaudiId("", "owner")).toContain("أدخل");
    expect(validateSaudiId("12345", "owner")).toContain("10 أرقام");
    expect(validateSaudiId("3023456789", "owner")).toContain("يبدأ");
  });
});

describe("validateFalLicense", () => {
  it("accepts a plausible licence number", () => {
    expect(validateFalLicense("1200012345")).toBeNull();
  });

  it("refuses an empty or implausible one", () => {
    expect(validateFalLicense("")).toContain("أدخل");
    expect(validateFalLicense("123")).toContain("غير صحيح");
    expect(validateFalLicense("1234567890123")).toContain("غير صحيح");
  });
});
