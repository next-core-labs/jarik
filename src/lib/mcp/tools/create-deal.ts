import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "create_deal",
  title: "إنشاء صفقة جديدة",
  description: "Add a new client request (lead) to the sales/rental pipeline.",
  inputSchema: {
    clientName: z.string().trim().min(2).max(160).describe("Client full name."),
    phone: z.string().trim().max(40).optional().describe("Client phone number."),
    requestType: z
      .string()
      .trim()
      .min(1)
      .default("rent")
      .describe("Request type, e.g. rent, buy, sell."),
    value: z.number().min(0).default(0).describe("Expected deal value in SAR."),
    notes: z.string().trim().max(2000).optional().describe("Free-form notes about the request."),
    propertyId: z.string().uuid().optional().describe("Related property id, if known."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ clientName, phone, requestType, value, notes, propertyId }, ctx) => {
    const supabase = requireClient(ctx);
    const { data, error } = await supabase
      .from("deals")
      .insert({
        client_name: clientName,
        request_type: requestType,
        stage: "lead",
        value,
        ...(phone ? { phone } : {}),
        ...(notes ? { notes } : {}),
        ...(propertyId ? { property_id: propertyId } : {}),
      })
      .select("id, client_name, stage, request_type, value, created_at")
      .single();
    failOn(error);
    const deal = {
      id: data!.id,
      clientName: data!.client_name,
      stage: data!.stage,
      requestType: data!.request_type,
      value: Number(data!.value ?? 0),
      createdAt: data!.created_at,
    };
    return jsonResult(`تمت إضافة الصفقة للعميل: ${deal.clientName}`, { deal });
  },
});
