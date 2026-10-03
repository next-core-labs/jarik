import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMyOrgId, requireStaff, type ServerCtx } from "@/lib/server-context";

export type EjarSyncResult = {
  configured: boolean;
  contractsFetched: number;
  leasesLinked: number;
  readingsImported: number;
  unmatched: string[];
  syncedAt: string | null;
};

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
        "id, ejar_contract_no, unit_id, tenant_id, status, units(unit_number), tenants(national_id)",
      );
    const { data: units } = await ctx.supabase.from("units").select("id, unit_number");

    const unitByNumber = new Map((units ?? []).map((u) => [String(u.unit_number).trim(), u.id]));

    let leasesLinked = 0;
    const unmatched: string[] = [];

    for (const c of contracts) {
      // A unit accumulates leases over time (past tenants who moved out, the current one). Matching
      // by contract number is unambiguous regardless of status — it's re-syncing a lease we already
      // linked. But the two fallback strategies (national ID, unit number alone) are only meaningful
      // against the unit/tenant's CURRENT tenancy: without restricting them to active leases, a
      // contract for today's tenant could match an old, ended lease on the same unit instead (or a
      // stale lease for someone who happens to share a national ID match path), silently overwriting
      // that unrelated historical record's dates/rent/contract number.
      const match =
        (leases ?? []).find((l) => l.ejar_contract_no && l.ejar_contract_no === c.contractNumber) ??
        (leases ?? []).find(
          (l) =>
            l.status === "active" &&
            c.tenantNationalId &&
            l.tenants?.national_id &&
            l.tenants.national_id === c.tenantNationalId,
        ) ??
        (leases ?? []).find(
          (l) =>
            l.status === "active" &&
            c.unitNumber &&
            l.units?.unit_number &&
            String(l.units.unit_number).trim() === c.unitNumber.trim(),
        );

      if (!match) {
        unmatched.push(c.contractNumber);
        continue;
      }

      const { error } = await supabaseAdmin
        .from("leases")
        .update({
          ejar_contract_no: c.contractNumber,
          ejar_status: "synced",
          ...(c.startDate ? { start_date: c.startDate.slice(0, 10) } : {}),
          ...(c.endDate ? { end_date: c.endDate.slice(0, 10) } : {}),
          ...(c.annualRent !== null ? { annual_rent: c.annualRent } : {}),
        })
        .eq("id", match.id);
      if (!error) leasesLinked += 1;

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
        const unitId = unitByNumber.get(r.unitNumber.trim());
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
      syncedAt,
    };
  });
