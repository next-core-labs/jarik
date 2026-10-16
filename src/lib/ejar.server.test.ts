import { afterEach, describe, expect, it, vi } from "vitest";

import { todayRiyadh } from "@/lib/dates";

import {
  fetchEjarContracts,
  fetchEjarMeterReadings,
  getEjarToken,
  readEjarConfig,
} from "./ejar.server";

const cfg = { baseUrl: "https://api.ejar.sa", clientId: "id", clientSecret: "secret" };

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("readEjarConfig", () => {
  it("returns null when any env var is missing", () => {
    vi.stubEnv("EJAR_API_BASE_URL", "");
    vi.stubEnv("EJAR_CLIENT_ID", "id");
    vi.stubEnv("EJAR_CLIENT_SECRET", "secret");
    expect(readEjarConfig()).toBeNull();
  });

  it("strips trailing slashes from the base URL", () => {
    vi.stubEnv("EJAR_API_BASE_URL", "https://api.ejar.sa///");
    vi.stubEnv("EJAR_CLIENT_ID", "id");
    vi.stubEnv("EJAR_CLIENT_SECRET", "secret");
    expect(readEjarConfig()).toEqual({
      baseUrl: "https://api.ejar.sa",
      clientId: "id",
      clientSecret: "secret",
    });
  });
});

describe("getEjarToken", () => {
  it("returns the access token on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok_123" })));
    await expect(getEjarToken(cfg)).resolves.toBe("tok_123");
  });

  it("throws an Arabic error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 401)));
    await expect(getEjarToken(cfg)).rejects.toThrow(/401/);
  });

  it("throws when the response has no access_token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));
    await expect(getEjarToken(cfg)).rejects.toThrow("لم تُرجع «إيجار» رمز وصول صالحًا");
  });
});

describe("fetchEjarContracts", () => {
  it("normalizes contracts across the known field-name aliases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              contract_number: "C-1",
              contractStatus: "active",
              start_date: "2026-01-01",
              totalRent: "24000",
              unit_number: "U-1",
              tenant: { identityNumber: "1000000001", name: "Ali" },
            },
          ],
        }),
      ),
    );
    const contracts = await fetchEjarContracts(cfg, "tok", null);
    expect(contracts).toEqual([
      {
        contractNumber: "C-1",
        status: "active",
        startDate: "2026-01-01",
        endDate: null,
        annualRent: 24000,
        unitNumber: "U-1",
        tenantNationalId: "1000000001",
        tenantName: "Ali",
        electricityMeterNo: null,
        waterMeterNo: null,
      },
    ]);
  });

  it("drops records with no recognizable contract number", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ items: [{ status: "active" }] })),
    );
    await expect(fetchEjarContracts(cfg, "tok", null)).resolves.toEqual([]);
  });

  it("returns an empty list when the payload shape is unexpected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ contracts: {} })));
    await expect(fetchEjarContracts(cfg, "tok", null)).resolves.toEqual([]);
  });

  it("throws an Arabic error when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    await expect(fetchEjarContracts(cfg, "tok", null)).rejects.toThrow(/500/);
  });
});

describe("fetchEjarMeterReadings", () => {
  it("classifies water meters by English or Arabic type hints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          readings: [
            { unit_number: "U-1", type: "water", value: 10, date: "2026-05-01" },
            { unit_number: "U-2", meterType: "مياه", reading: 5, readingDate: "2026-05-02" },
            { unit_number: "U-3", type: "electricity", reading: 7 },
          ],
        }),
      ),
    );
    const readings = await fetchEjarMeterReadings(cfg, "tok", null);
    expect(readings.map((r) => r.meterType)).toEqual(["water", "water", "electricity"]);
  });

  it("skips entries missing a unit number or a numeric reading", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ data: [{ reading: 10 }, { unitNumber: "U-1", reading: "n/a" }] }),
        ),
    );
    await expect(fetchEjarMeterReadings(cfg, "tok", null)).resolves.toEqual([]);
  });

  it("falls back to today's date when the source date is unparsable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ data: [{ unitNumber: "U-1", reading: 3, date: "not-a-date" }] }),
        ),
    );
    const [reading] = await fetchEjarMeterReadings(cfg, "tok", null);
    // Saudi "today", like the code: the UTC slice is still yesterday between 00:00-03:00 Riyadh.
    expect(reading?.readingDate).toBe(todayRiyadh());
  });

  it("treats a non-ok response as 'not enabled' rather than an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false, 404)));
    await expect(fetchEjarMeterReadings(cfg, "tok", null)).resolves.toEqual([]);
  });
});
