import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/** What `requireSupabaseAuth` puts on a server function's context (user-scoped client, RLS applies). */
export type ServerCtx = { supabase: SupabaseClient<Database>; userId: string };

/** Throws unless the caller is admin/staff. Fails closed if the check itself errors. */
export async function requireStaff(ctx: ServerCtx): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("is_staff", { _user_id: ctx.userId });
  if (error || !data) throw new Error("هذه الصلاحية لموظفي المكتب فقط");
}

/** The office the caller works for. Throws if the account is not an employee of any office. */
export async function getMyOrgId(ctx: ServerCtx): Promise<string> {
  const { data, error } = await ctx.supabase.rpc("my_org_id");
  if (error || !data) throw new Error("حسابك غير تابع لمكتب");
  return data;
}

/** Throws unless the caller is a platform admin. Fails closed if the check itself errors. */
export async function requireAdmin(ctx: ServerCtx): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || !data) throw new Error("هذه الصلاحية لمدير النظام فقط");
}

/**
 * Throws unless the caller holds `super_admin` — a role deliberately separate from `admin` and
 * outside `is_staff`/org_isolation scope. Fails closed if the check itself errors.
 */
export async function requireSuperAdmin(ctx: ServerCtx): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "super_admin",
  });
  if (error || !data) throw new Error("هذه الصلاحية للمدير العام فقط");
}

/**
 * Throws unless the caller is `super_admin` (full access) or a delegated `hq_admins` row grants
 * this specific section permission. Fails closed on any lookup error.
 */
export async function requireHqPermission(ctx: ServerCtx, permission: string): Promise<void> {
  const { data: isSuperAdmin, error: roleError } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "super_admin",
  });
  if (roleError) throw new Error("تعذّر التحقق من صلاحيتك");
  if (isSuperAdmin) return;

  const { data, error } = await ctx.supabase
    .from("hq_admins")
    .select("permissions")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error || !data?.permissions?.includes(permission)) {
    throw new Error("ليست لديك صلاحية الوصول لهذا القسم");
  }
}
