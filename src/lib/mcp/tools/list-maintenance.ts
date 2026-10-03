import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_maintenance_requests",
  title: "طلبات الصيانة",
  description:
    "List maintenance requests with their status, priority, unit and assigned technician. Filter by status or priority.",
  inputSchema: {
    status: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Status filter, e.g. new, assigned, in_progress, done, closed."),
    priority: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Priority filter, e.g. low, normal, high."),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, priority, limit }, ctx) => {
    const supabase = requireClient(ctx);
    let query = supabase
      .from("maintenance_requests")
      .select(
        "id, title, description, status, priority, cost, source, approval_status, scheduled_at, rating, created_at, unit_id, units(unit_number, property_id)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (priority) query = query.eq("priority", priority);

    const { data, error } = await query;
    failOn(error);
    const requests = (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      cost: Number(r.cost ?? 0),
      source: r.source,
      approvalStatus: r.approval_status,
      scheduledAt: r.scheduled_at,
      rating: r.rating,
      createdAt: r.created_at,
      unitId: r.unit_id,
      unitNumber: (r.units as { unit_number?: string } | null)?.unit_number ?? null,
    }));
    return jsonResult(JSON.stringify(requests, null, 2), { requests });
  },
});
