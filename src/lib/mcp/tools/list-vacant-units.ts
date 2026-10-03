import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_vacant_units",
  title: "الوحدات المتاحة للإيجار",
  description:
    "List units currently advertised as available for rent, with rent, type and the listing office name.",
  inputSchema: {
    city: z.string().trim().min(1).optional().describe("Filter by the listing office city."),
    maxAnnualRent: z
      .number()
      .min(0)
      .optional()
      .describe("Only units at or below this annual rent."),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ city, maxAnnualRent, limit }, ctx) => {
    const supabase = requireClient(ctx);
    let query = supabase.from("vacant_units_public").select("*").limit(limit);
    if (maxAnnualRent !== undefined) query = query.lte("annual_rent", maxAnnualRent);
    if (city) query = query.eq("office_city", city);

    const { data, error } = await query;
    failOn(error);
    const units = (data ?? []).map((u) => {
      const row = u as Record<string, unknown>;
      const out: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(row)) {
        out[key] =
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? value
            : value === null || value === undefined
              ? null
              : String(value);
      }
      return out;
    });
    return jsonResult(JSON.stringify(units, null, 2), { units });
  },
});
