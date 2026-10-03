import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { addDays, todayRiyadh } from "../../dates";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_leases",
  title: "قائمة العقود",
  description:
    "List lease contracts with tenant, unit, rent and dates. Use expiringWithinDays to find contracts that need renewal soon.",
  inputSchema: {
    status: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Lease status filter, e.g. active, ended."),
    expiringWithinDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Only leases whose end date falls within this many days from today."),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, expiringWithinDays, limit }, ctx) => {
    const supabase = requireClient(ctx);
    let query = supabase
      .from("leases")
      .select(
        "id, status, start_date, end_date, annual_rent, deposit, deposit_status, installments, ejar_contract_no, ejar_status, tenant_id, unit_id, tenants(full_name, phone), units(unit_number, unit_type)",
      )
      .order("end_date", { ascending: true })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (expiringWithinDays !== undefined) {
      const today = todayRiyadh();
      query = query.gte("end_date", today).lte("end_date", addDays(today, expiringWithinDays));
    }

    const { data, error } = await query;
    failOn(error);
    const leases = (data ?? []).map((l) => ({
      id: l.id,
      status: l.status,
      startDate: l.start_date,
      endDate: l.end_date,
      annualRent: Number(l.annual_rent ?? 0),
      deposit: Number(l.deposit ?? 0),
      depositStatus: l.deposit_status,
      installments: l.installments,
      ejarContractNo: l.ejar_contract_no,
      ejarStatus: l.ejar_status,
      tenantId: l.tenant_id,
      tenantName: (l.tenants as { full_name?: string } | null)?.full_name ?? null,
      tenantPhone: (l.tenants as { phone?: string | null } | null)?.phone ?? null,
      unitId: l.unit_id,
      unitNumber: (l.units as { unit_number?: string } | null)?.unit_number ?? null,
    }));
    return jsonResult(JSON.stringify(leases, null, 2), { leases });
  },
});
