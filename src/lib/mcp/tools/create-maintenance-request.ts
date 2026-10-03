import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { classifyMaintenancePriority } from "@/lib/maintenance-triage";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "create_maintenance_request",
  title: "إنشاء طلب صيانة",
  description:
    "Create a new maintenance request for a unit. Use list_units to find the unit id first.",
  inputSchema: {
    unitId: z.string().uuid().describe("Unit the request belongs to."),
    title: z.string().trim().min(2).max(160).describe("Short title of the problem."),
    description: z.string().trim().max(2000).optional().describe("Details of the problem."),
    // Matches the app's real priority values (low/medium/high/urgent) — an earlier "normal" here
    // didn't match any of them, so it stored an unlabeled value nothing else in the app recognizes.
    priority: z
      .enum(["low", "medium", "high", "urgent"])
      .default("medium")
      .describe("Urgency of the request."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ unitId, title, description, priority }, ctx) => {
    const supabase = requireClient(ctx);
    const { data, error } = await supabase
      .from("maintenance_requests")
      .insert({
        unit_id: unitId,
        title,
        priority: classifyMaintenancePriority(title, description, priority),
        source: "mcp",
        ...(description ? { description } : {}),
      })
      .select("id, title, status, priority, unit_id, created_at")
      .single();
    failOn(error);
    const request = {
      id: data!.id,
      title: data!.title,
      status: data!.status,
      priority: data!.priority,
      unitId: data!.unit_id,
      createdAt: data!.created_at,
    };
    return jsonResult(`تم إنشاء طلب الصيانة: ${request.title}`, { request });
  },
});
