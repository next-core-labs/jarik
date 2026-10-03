import { defineTool } from "@lovable.dev/mcp-js";
import { todayRiyadh } from "../../dates";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "portfolio_summary",
  title: "ملخص المحفظة العقارية",
  description:
    "Overall portfolio snapshot for the signed-in user: counts of properties, units by status, active leases, overdue payments and open maintenance requests.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const supabase = requireClient(ctx);
    const today = todayRiyadh();

    const [properties, units, leases, payments, maintenance] = await Promise.all([
      supabase.from("properties").select("id", { count: "exact", head: true }),
      supabase.from("units").select("status"),
      supabase.from("leases").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("payments").select("amount").neq("status", "paid").lt("due_date", today),
      supabase
        .from("maintenance_requests")
        .select("id", { count: "exact", head: true })
        .not("status", "in", "(closed,done)"),
    ]);

    failOn(properties.error);
    failOn(units.error);
    failOn(leases.error);
    failOn(payments.error);
    failOn(maintenance.error);

    const unitsByStatus: Record<string, number> = {};
    for (const unit of units.data ?? []) {
      unitsByStatus[unit.status] = (unitsByStatus[unit.status] ?? 0) + 1;
    }
    const overdueAmount = (payments.data ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

    const summary = {
      properties: properties.count ?? 0,
      units: units.data?.length ?? 0,
      unitsByStatus,
      activeLeases: leases.count ?? 0,
      overduePayments: payments.data?.length ?? 0,
      overdueAmount,
      openMaintenance: maintenance.count ?? 0,
    };

    return jsonResult(JSON.stringify(summary, null, 2), { summary });
  },
});
