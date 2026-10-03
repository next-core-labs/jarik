import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_properties",
  title: "قائمة العقارات",
  description:
    "List real-estate properties visible to the signed-in user, optionally filtered by city or a text search on the name.",
  inputSchema: {
    city: z.string().trim().min(1).optional().describe("Filter by city name."),
    search: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Case-insensitive match on property name."),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ city, search, limit }, ctx) => {
    const supabase = requireClient(ctx);
    let query = supabase
      .from("properties")
      .select(
        "id, name, property_type, city, district, address, owner_name, deed_number, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (city) query = query.eq("city", city);
    if (search) query = query.ilike("name", `%${search}%`);

    const { data, error } = await query;
    failOn(error);
    const properties = (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      propertyType: p.property_type,
      city: p.city,
      district: p.district,
      address: p.address,
      ownerName: p.owner_name,
      deedNumber: p.deed_number,
    }));
    return jsonResult(JSON.stringify(properties, null, 2), { properties });
  },
});
