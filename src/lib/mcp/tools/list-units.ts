import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_units",
  title: "قائمة الوحدات",
  description:
    "List units (apartments, shops, offices) with their rent, status and property, optionally filtered by property or status.",
  inputSchema: {
    propertyId: z.string().uuid().optional().describe("Restrict to one property id."),
    status: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Unit status filter, e.g. vacant, occupied, maintenance."),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ propertyId, status, limit }, ctx) => {
    const supabase = requireClient(ctx);
    let query = supabase
      .from("units")
      .select(
        "id, unit_number, unit_name, unit_type, status, annual_rent, rooms, bathrooms, halls, area, floor_no, furnished, district, property_id, properties(name, city)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (propertyId) query = query.eq("property_id", propertyId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    failOn(error);
    const units = (data ?? []).map((u) => ({
      id: u.id,
      unitNumber: u.unit_number,
      unitName: u.unit_name,
      unitType: u.unit_type,
      status: u.status,
      annualRent: Number(u.annual_rent ?? 0),
      rooms: u.rooms,
      bathrooms: u.bathrooms,
      halls: u.halls,
      area: u.area,
      floorNo: u.floor_no,
      furnished: u.furnished,
      district: u.district,
      propertyId: u.property_id,
      propertyName: (u.properties as { name?: string } | null)?.name ?? null,
      city: (u.properties as { city?: string | null } | null)?.city ?? null,
    }));
    return jsonResult(JSON.stringify(units, null, 2), { units });
  },
});
