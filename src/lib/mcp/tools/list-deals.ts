import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_deals",
  title: "قائمة الصفقات",
  description:
    "List sales and rental deals in the pipeline with client, stage, value and commission. Filter by stage or request type.",
  inputSchema: {
    stage: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Pipeline stage filter, e.g. lead, won, lost."),
    requestType: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Request type filter, e.g. rent, buy."),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ stage, requestType, limit }, ctx) => {
    const supabase = requireClient(ctx);
    let query = supabase
      .from("deals")
      .select(
        "id, client_name, phone, request_type, stage, value, commission, notes, property_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (stage) query = query.eq("stage", stage);
    if (requestType) query = query.eq("request_type", requestType);

    const { data, error } = await query;
    failOn(error);
    const deals = (data ?? []).map((d) => ({
      id: d.id,
      clientName: d.client_name,
      phone: d.phone,
      requestType: d.request_type,
      stage: d.stage,
      value: Number(d.value ?? 0),
      commission: Number(d.commission ?? 0),
      notes: d.notes,
      propertyId: d.property_id,
      createdAt: d.created_at,
    }));
    return jsonResult(JSON.stringify(deals, null, 2), { deals });
  },
});
