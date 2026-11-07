import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMyOrgId, requireStaff, type ServerCtx } from "@/lib/server-context";

export type EjarSyncResult = {
  configured: boolean;
  contractsFetched: number;
  leasesLinked: number;
  readingsImported: number;
  unmatched: string[];
  /** Linked contracts whose dates or rent differ from the lease: stored for review, not applied. */
  needsReview: string[];
  syncedAt: string | null;
};

/** Ejar's own terms for a lease, kept on leases.ejar_mismatch when they disagree with ours. */
export type EjarMismatch = {
  contract_no: string;
  start_date: string | null;
  end_date: string | null;
  annual_rent: number | null;
  checked_at: string;
};

/** Text compared loosely: trimmed, case-folded, Arabic-Indic digits as Latin. */
const norm = (v: string | null | undefined) =>
  (v ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim()
    .toLowerCase();

export const getEjarConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireStaff(context as unknown as ServerCtx);
    const { readEjarConfig } = await import("./ejar.server");
    const cfg = readEjarConfig();
    return { configured: cfg !== null, baseUrl: cfg?.baseUrl ?? null };
  });

export const syncEjar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<EjarSyncResult> => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    const orgId = await getMyOrgId(ctx);

    const { readEjarConfig, getEjarToken, fetchEjarContracts, fetchEjarMeterReadings } =
      await import("./ejar.server");
    const cfg = readEjarConfig();
    if (!cfg) {
      return {
        configured: false,
        contractsFetched: 0,
        leasesLinked: 0,
        readingsImported: 0,
        unmatched: [],
        needsReview: [],
        syncedAt: null,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: org } = await supabaseAdmin
      .from("org_settings")
      .select("id, ejar_broker_id")
      .eq("id", orgId)
      .maybeSingle();

    // The broker id is what separates one office's contracts from another's inside the shared
    // platform credential. Without it, this office would import every office's contracts.
    if (!org?.ejar_broker_id) {
      throw new Error("أضف رقم الوسيط في «إيجار» لمكتبك قبل المزامنة — تواصل مع إدارة المنصة");
    }

    const token = await getEjarToken(cfg);
    const contracts = await fetchEjarContracts(cfg, token, org.ejar_broker_id);

    // Match only against this office's own leases and units: reading with the caller's client keeps
    // it inside the office (row-level security), so the admin client below can only ever write to them.
    const { data: leases } = await ctx.supabase
      .from("leases")
      .select(
        "id, ejar_contract_no, unit_id, tenant_id, status, start_date, end_date, annual_rent, units(unit_number, deed_number, properties(name)), tenants(national_id)",
      );
    const { data: units } = await ctx.supabase.from("units").select("id, unit_number");

    // A unit number alone is ambiguous across buildings: only numbers that occur once in the
    // office identify a unit for meter readings.
    const unitsPerNumber = new Map<string, string[]>();
    for (const u of units ?? []) {
      const key = norm(String(u.unit_number));
      unitsPerNumber.set(key, [...(unitsPerNumber.get(key) ?? []), u.id]);
    }
    const unitByNumber = new Map(
      [...unitsPerNumber.entries()]
        .filter(([, ids]) => ids.length === 1)
        .map(([k, ids]) => [k, ids[0]!]),
    );

    let leasesLinked = 0;
    const unmatched: string[] = [];
    const needsReview: string[] = [];
    const active = (leases ?? []).filter((l) => l.status === "active");

    for (const contract of contracts) {
      // ejar.server.ts may also read the contract's property (name / deed number); when it does,
      // a unit-number match must be in that property too.
      const c = contract as typeof contract & {
        propertyName?: string | null;
        deedNumber?: string | null;
      };
      const sameUnit = (l: (typeof active)[number]) =>
        !!c.unitNumber && norm(l.units?.unit_number) === norm(c.unitNumber);
      const sameProperty = (l: (typeof active)[number]) =>
        (!c.deedNumber || norm(l.units?.deed_number) === norm(c.deedNumber)) &&
        (!c.propertyName || norm(l.units?.properties?.name) === norm(c.propertyName));
      const sameTenant = (l: (typeof active)[number]) =>
        !!c.tenantNationalId && norm(l.tenants?.national_id) === norm(c.tenantNationalId);
      /** The single candidate, or null when there is none or more than one. */
      const only = <T>(rows: T[]) => (rows.length === 1 ? rows[0]! : null);

      // A unit accumulates leases over time. The contract number is unambiguous whatever the
      // status (re-syncing a lease already linked); the fallbacks only consider CURRENT tenancies,
      // need the unit (and property, when Ejar gives it) to agree, and give up when more than one
      // lease fits instead of guessing.
      const match =
        (leases ?? []).find((l) => l.ejar_contract_no && l.ejar_contract_no === c.contractNumber) ??
        only(active.filter((l) => sameTenant(l) && sameUnit(l) && sameProperty(l))) ??
        (c.unitNumber ? null : only(active.filter((l) => sameTenant(l)))) ??
        (c.tenantNationalId ? null : only(active.filter((l) => sameUnit(l) && sameProperty(l))));

      if (!match) {
        unmatched.push(c.contractNumber);
        continue;
      }

      // Our dates and rent drive the payment schedule, so Ejar's are never written over them:
      // a disagreement is stored for staff to review (and apply with «تصحيح العقد»).
      const start = c.startDate?.slice(0, 10) ?? null;
      const end = c.endDate?.slice(0, 10) ?? null;
      const differs =
        (start !== null && start !== match.start_date) ||
        (end !== null && end !== match.end_date) ||
        (c.annualRent !== null && Number(c.annualRent) !== Number(match.annual_rent));
      const mismatch: EjarMismatch | null = differs
        ? {
            contract_no: c.contractNumber,
            start_date: start,
            end_date: end,
            annual_rent: c.annualRent,
            checked_at: new Date().toISOString(),
          }
        : null;

      const { error } = await supabaseAdmin
        .from("leases")
        .update({
          ejar_contract_no: c.contractNumber,
          ejar_status: "synced",
          ejar_mismatch: mismatch,
        })
        .eq("id", match.id);
      if (!error) {
        leasesLinked += 1;
        if (mismatch) needsReview.push(c.contractNumber);
      }

      if (c.electricityMeterNo || c.waterMeterNo) {
        await supabaseAdmin
          .from("units")
          .update({
            ...(c.electricityMeterNo ? { electricity_meter_no: c.electricityMeterNo } : {}),
            ...(c.waterMeterNo ? { water_meter_no: c.waterMeterNo } : {}),
          })
          .eq("id", match.unit_id);
      }
    }

    const readings = await fetchEjarMeterReadings(cfg, token, org.ejar_broker_id);
    const readingRows = readings
      .map((r) => {
        const unitId = unitByNumber.get(norm(r.unitNumber));
        if (!unitId) return null;
        return {
          unit_id: unitId,
          meter_type: r.meterType,
          reading: r.reading,
          reading_date: r.readingDate,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Plain INSERT duplicated every reading on every re-sync (no de-duplication at all against
    // what a previous sync already imported for the same unit/meter/date). Upsert against the
    // (unit_id, meter_type, reading_date) unique index instead — a re-sync now updates that day's
    // reading if it changed, or is a no-op if it didn't, rather than piling up duplicate rows.
    let readingsImported = 0;
    if (readingRows.length > 0) {
      const { data: upserted, error } = await supabaseAdmin
        .from("meter_readings")
        .upsert(readingRows, { onConflict: "unit_id,meter_type,reading_date" })
        .select("id");
      if (!error) readingsImported = upserted?.length ?? 0;
    }

    const syncedAt = new Date().toISOString();
    if (org) {
      await supabaseAdmin
        .from("org_settings")
        .update({ ejar_enabled: true, ejar_last_sync: syncedAt })
        .eq("id", org.id);
    }

    return {
      configured: true,
      contractsFetched: contracts.length,
      leasesLinked,
      readingsImported,
      unmatched: unmatched.slice(0, 10),
      needsReview: needsReview.slice(0, 10),
      syncedAt,
    };
  });
