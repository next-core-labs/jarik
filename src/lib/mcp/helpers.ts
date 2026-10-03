import { ToolError, type ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";

/** Ensures the caller is authenticated and returns a user-scoped Supabase client. */
export function requireClient(ctx: ToolContext) {
  if (!ctx.isAuthenticated()) {
    throw new ToolError("يجب تسجيل الدخول بحساب جارك لاستخدام هذه الأداة.");
  }
  return supabaseForUser(ctx);
}

// The MCP caller gets a generic message — the raw Postgres/PostgREST error can carry internal
// RLS-policy, table, or column text that a probing MCP client shouldn't see. The real message is
// still logged server-side for debugging.
export function failOn(error: { message: string } | null): void {
  if (!error) return;
  console.error("[mcp] query failed:", error.message);
  throw new ToolError("تعذّر تنفيذ الطلب — تحقق من صلاحياتك أو البيانات المُرسَلة.");
}

export function jsonResult<T>(text: string, structuredContent: T) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}
