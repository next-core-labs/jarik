import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { failOn, jsonResult, requireClient } from "../helpers";

export default defineTool({
  name: "list_tenants",
  title: "قائمة المستأجرين",
  description: "List tenants with their contact details, optionally searched by name.",
  inputSchema: {
    search: z.string().trim().min(1).optional().describe("Case-insensitive match on tenant name."),
    limit: z.number().int().min(1).max(100).default(25).describe("Maximum rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    const supabase = requireClient(ctx);
    let query = supabase
      .from("tenants")
      .select("id, full_name, phone, email, national_id, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (search) query = query.ilike("full_name", `%${search}%`);

    const { data, error } = await query;
    failOn(error);
    const tenants = (data ?? []).map((t) => ({
      id: t.id,
      fullName: t.full_name,
      phone: t.phone,
      email: t.email,
      nationalId: t.national_id,
      notes: t.notes,
    }));
    return jsonResult(JSON.stringify(tenants, null, 2), { tenants });
  },
});
