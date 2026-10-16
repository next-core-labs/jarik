import { describe, expect, it } from "vitest";

import { parseAmount, parseSaudiMobile } from "./public-form";

describe("parseSaudiMobile", () => {
  it("accepts the usual ways of writing a Saudi mobile", () => {
    expect(parseSaudiMobile("0501234567")).toBe("0501234567");
    expect(parseSaudiMobile("501234567")).toBe("0501234567");
    expect(parseSaudiMobile("+966 50 123 4567")).toBe("0501234567");
    expect(parseSaudiMobile("00966501234567")).toBe("0501234567");
    expect(parseSaudiMobile("050-123-4567")).toBe("0501234567");
    expect(parseSaudiMobile("٠٥٠١٢٣٤٥٦٧")).toBe("0501234567");
  });

  it("rejects letters, landlines and wrong lengths", () => {
    expect(parseSaudiMobile("abcdefghij")).toBeNull();
    expect(parseSaudiMobile("05012345a7")).toBeNull();
    expect(parseSaudiMobile("0112345678")).toBeNull();
    expect(parseSaudiMobile("050123456")).toBeNull();
    expect(parseSaudiMobile("05012345678")).toBeNull();
    expect(parseSaudiMobile("")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("is undefined when empty", () => {
    expect(parseAmount("")).toBeUndefined();
    expect(parseAmount("   ")).toBeUndefined();
  });

  it("reads Latin and Arabic-Indic digits with separators", () => {
    expect(parseAmount("60000")).toBe(60000);
    expect(parseAmount("60,000")).toBe(60000);
    expect(parseAmount("٦٠٬٠٠٠")).toBe(60000);
    expect(parseAmount("١٥٠٠٫٥")).toBe(1500.5);
  });

  it("is null for anything that isn't a number", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("12k")).toBeNull();
  });
});
