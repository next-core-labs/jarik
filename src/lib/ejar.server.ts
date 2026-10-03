/**
 * Real "Ejar" (إيجار) integration helpers.
 *
 * Credentials come from project secrets:
 *   EJAR_API_BASE_URL  e.g. https://api.ejar.sa
 *   EJAR_CLIENT_ID
 *   EJAR_CLIENT_SECRET
 */

import { todayRiyadh } from "@/lib/dates";

export type EjarConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

export function readEjarConfig(): EjarConfig | null {
  const baseUrl = process.env["EJAR_API_BASE_URL"];
  const clientId = process.env["EJAR_CLIENT_ID"];
  const clientSecret = process.env["EJAR_CLIENT_SECRET"];
  if (!baseUrl || !clientId || !clientSecret) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), clientId, clientSecret };
}

export async function getEjarToken(cfg: EjarConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`تعذّر تسجيل الدخول إلى «إيجار» (${res.status})`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("لم تُرجع «إيجار» رمز وصول صالحًا");
  return json.access_token;
}

export type EjarContract = {
  contractNumber: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: number | null;
  unitNumber: string | null;
  tenantNationalId: string | null;
  tenantName: string | null;
  electricityMeterNo: string | null;
  waterMeterNo: string | null;
};

type RawRecord = Record<string, unknown>;

const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Ejar payload field names vary by environment; read the common aliases. */
function normalizeContract(raw: RawRecord): EjarContract | null {
  const contractNumber =
    str(raw["contractNumber"]) ??
    str(raw["contract_number"]) ??
    str(raw["contractNo"]) ??
    str(raw["ejarContractNumber"]);
  if (!contractNumber) return null;
  const unit = (raw["unit"] ?? {}) as RawRecord;
  const tenant = (raw["tenant"] ?? {}) as RawRecord;
  return {
    contractNumber,
    status: str(raw["status"]) ?? str(raw["contractStatus"]),
    startDate: str(raw["startDate"]) ?? str(raw["start_date"]),
    endDate: str(raw["endDate"]) ?? str(raw["end_date"]),
    annualRent: num(raw["annualRent"] ?? raw["totalRent"] ?? raw["rentAmount"]),
    unitNumber:
      str(raw["unitNumber"]) ??
      str(raw["unit_number"]) ??
      str(unit["unitNumber"]) ??
      str(unit["number"]),
    tenantNationalId:
      str(raw["tenantNationalId"]) ?? str(tenant["nationalId"]) ?? str(tenant["identityNumber"]),
    tenantName: str(tenant["name"]) ?? str(raw["tenantName"]),
    electricityMeterNo:
      str(raw["electricityMeterNumber"]) ?? str(unit["electricityMeterNumber"]) ?? null,
    waterMeterNo: str(raw["waterMeterNumber"]) ?? str(unit["waterMeterNumber"]) ?? null,
  };
}

export async function fetchEjarContracts(
  cfg: EjarConfig,
  token: string,
  brokerId: string | null,
): Promise<EjarContract[]> {
  const url = new URL(`${cfg.baseUrl}/v1/contracts`);
  if (brokerId) url.searchParams.set("brokerId", brokerId);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`تعذّر جلب العقود من «إيجار» (${res.status})`);
  const json = (await res.json()) as RawRecord;
  const list = (json["data"] ?? json["contracts"] ?? json["items"] ?? json) as unknown;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => normalizeContract(item as RawRecord))
    .filter((c): c is EjarContract => c !== null);
}

export type EjarMeterReading = {
  unitNumber: string;
  meterType: "electricity" | "water";
  reading: number;
  readingDate: string;
};

export async function fetchEjarMeterReadings(
  cfg: EjarConfig,
  token: string,
  brokerId: string | null,
): Promise<EjarMeterReading[]> {
  const url = new URL(`${cfg.baseUrl}/v1/meters/readings`);
  if (brokerId) url.searchParams.set("brokerId", brokerId);
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  // Meter readings are an optional capability; a 404 just means it isn't enabled.
  if (!res.ok) return [];
  const json = (await res.json()) as RawRecord;
  const list = (json["data"] ?? json["readings"] ?? json["items"] ?? json) as unknown;
  if (!Array.isArray(list)) return [];
  const out: EjarMeterReading[] = [];
  for (const item of list as RawRecord[]) {
    const unitNumber = str(item["unitNumber"]) ?? str(item["unit_number"]);
    const reading = num(item["reading"] ?? item["value"]);
    if (!unitNumber || reading === null) continue;
    const typeRaw = (str(item["meterType"]) ?? str(item["type"]) ?? "electricity").toLowerCase();
    const dateRaw = str(item["readingDate"]) ?? str(item["date"]);
    const parsed = dateRaw ? new Date(dateRaw) : null;
    // A missing/unparsable date falls back to "today" in Saudi time, not the UTC calendar date —
    // see src/lib/dates.ts for why the UTC slice is still "yesterday" between 00:00-03:00 Riyadh.
    out.push({
      unitNumber,
      meterType: typeRaw.includes("water") || typeRaw.includes("مياه") ? "water" : "electricity",
      reading,
      readingDate:
        parsed && !Number.isNaN(parsed.getTime())
          ? parsed.toISOString().slice(0, 10)
          : todayRiyadh(),
    });
  }
  return out;
}
