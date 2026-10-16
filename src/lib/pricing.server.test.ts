import { afterEach, describe, expect, it, vi } from "vitest";

import { generateAdAi, suggestRentAi } from "./pricing.server";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const baseInput = {
  unitType: "شقة",
  district: "النرجس",
  rooms: 3,
  halls: 1,
  bathrooms: 2,
  area: 150,
  furnished: false,
  floorNo: "2",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("suggestRentAi", () => {
  it("uses the AI suggestion when the gateway returns a valid, positive rent", async () => {
    vi.stubEnv("AI_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: '{"suggested_rent": 32000, "reasoning": "سبب"}' } }],
        }),
      ),
    );
    const result = await suggestRentAi({ ...baseInput, market: [] });
    expect(result).toEqual({ suggestedRent: 32000, reasoning: "سبب", source: "ai" });
  });

  it("falls back to the district average when there is no API key", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const result = await suggestRentAi({
      ...baseInput,
      market: [
        { district: "النرجس", units_count: 5, avg_rent: 30000 },
        { district: "الملقا", units_count: 2, avg_rent: 40000 },
      ],
    });
    expect(result.source).toBe("market_avg");
    expect(result.suggestedRent).toBe(30000);
  });

  it("falls back to the overall market average when the district has no data", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const result = await suggestRentAi({
      ...baseInput,
      district: "حي غير موجود",
      market: [
        { district: "أ", units_count: 1, avg_rent: 20000 },
        { district: "ب", units_count: 1, avg_rent: 40000 },
      ],
    });
    expect(result.source).toBe("market_avg");
    expect(result.suggestedRent).toBe(30000);
  });

  it("reports 'unavailable' when there is neither an AI answer nor market data", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const result = await suggestRentAi({ ...baseInput, market: [] });
    expect(result).toEqual({
      suggestedRent: null,
      reasoning: "لا تتوفر بيانات كافية للتسعير — أدخل السعر يدويًا.",
      source: "unavailable",
    });
  });

  it("falls back to market average when the AI response is not valid JSON", async () => {
    vi.stubEnv("AI_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "garbage" } }] })),
    );
    const result = await suggestRentAi({
      ...baseInput,
      market: [{ district: "النرجس", units_count: 1, avg_rent: 25000 }],
    });
    expect(result.source).toBe("market_avg");
    expect(result.suggestedRent).toBe(25000);
  });

  it("falls back to market average when the gateway request fails", async () => {
    vi.stubEnv("AI_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));
    const result = await suggestRentAi({
      ...baseInput,
      market: [{ district: "النرجس", units_count: 1, avg_rent: 25000 }],
    });
    expect(result.source).toBe("market_avg");
  });

  it("ignores a non-positive AI rent and falls back", async () => {
    vi.stubEnv("AI_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ choices: [{ message: { content: '{"suggested_rent": 0}' } }] }),
        ),
    );
    const result = await suggestRentAi({
      ...baseInput,
      market: [{ district: "النرجس", units_count: 1, avg_rent: 25000 }],
    });
    expect(result.source).toBe("market_avg");
  });
});

const adInput = {
  unitNumber: "101",
  unitName: null,
  unitType: "شقة",
  district: "النرجس",
  street: null,
  floorNo: "2",
  rooms: 3,
  halls: 1,
  bathrooms: 2,
  area: 150,
  annualRent: 30000,
  furnished: true,
  officeName: "مكتب الديار",
  officePhone: "0500000000",
  city: "الرياض",
};

describe("generateAdAi", () => {
  it("uses the AI-generated text when available", async () => {
    vi.stubEnv("AI_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ choices: [{ message: { content: '{"text": "إعلان ذكي"}' } }] }),
        ),
    );
    await expect(generateAdAi(adInput)).resolves.toEqual({ text: "إعلان ذكي", source: "ai" });
  });

  it("builds a template ad from the unit fields when there is no API key", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const result = await generateAdAi(adInput);
    expect(result.source).toBe("template");
    expect(result.text).toContain("شقة");
    expect(result.text).toContain("حي النرجس");
    expect(result.text).toContain(`${(30000).toLocaleString("ar-SA")} ريال`);
    expect(result.text).toContain("مؤثثة");
    expect(result.text).toContain("📞 0500000000");
  });

  it("omits blank optional fields from the template", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const result = await generateAdAi({
      ...adInput,
      district: null,
      city: null,
      officeName: null,
      officePhone: null,
      rooms: null,
      halls: null,
      bathrooms: null,
      area: null,
      furnished: false,
    });
    expect(result.text).not.toContain("حي");
    expect(result.text).not.toContain("للتواصل");
    expect(result.text).toContain("غير مؤثثة");
  });

  it("falls back to the template when the AI text is empty", async () => {
    vi.stubEnv("AI_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{"text": "  "}' } }] })),
    );
    const result = await generateAdAi(adInput);
    expect(result.source).toBe("template");
  });
});
