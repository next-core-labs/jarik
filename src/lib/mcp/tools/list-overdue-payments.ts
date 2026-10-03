import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { todayRiyadh } from "../../dates";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_overdue_payments",
  title: "الدفعات المتأخرة",
  description:
    "List rent installments that are unpaid and past their due date, with tenant, unit and amount, plus the total overdue amount.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(50).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const supabase = requireClient(ctx);
    const today = todayRiyadh();
    const { data, error } = await supabase
      .from("payments")
      .select(
        "id, amount, due_date, status, method, reference, last_reminded_at, lease_id, leases(tenant_id, unit_id, tenants(full_name, phone), units(unit_number))",
      )
      .neq("status", "paid")
      .lt("due_date", today)
      .order("due_date", { ascending: true })
      .limit(limit);
    failOn(error);

    const payments = (data ?? []).map((p) => {
      const lease = p.leases as {
        tenants?: { full_name?: string; phone?: string | null } | null;
        units?: { unit_number?: string } | null;
      } | null;
      return {
        id: p.id,
        amount: Number(p.amount ?? 0),
        dueDate: p.due_date,
        status: p.status,
        method: p.method,
        reference: p.reference,
        lastRemindedAt: p.last_reminded_at,
        leaseId: p.lease_id,
        tenantName: lease?.tenants?.full_name ?? null,
        tenantPhone: lease?.tenants?.phone ?? null,
        unitNumber: lease?.units?.unit_number ?? null,
      };
    });
    const totalOverdue = payments.reduce((sum, p) => sum + p.amount, 0);
    return jsonResult(JSON.stringify({ totalOverdue, payments }, null, 2), {
      totalOverdue,
      payments,
    });
  },
});
