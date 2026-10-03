import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, requireStaff, type ServerCtx } from "@/lib/server-context";
import { fetchAllRows, listAllAuthUsers } from "@/lib/admin-shared";

const roleSchema = z.enum(["admin", "staff", "owner", "tenant", "technician"]);

/**
 * حسابات العملاء (مالك/مستأجر) لإسناد الوحدات — لموظفي المكتب.
 * تعرض أشخاص مكتب الموظف فقط (موظفوه وعملاؤه المرتبطون)، لا كل مسجّلي المنصة.
 */
export const listClientAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    const { data, error } = await ctx.supabase.rpc("office_people");
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => ({
      id: p.user_id,
      email: p.email ?? "",
      fullName: p.full_name ?? "",
      roles: p.roles ?? [],
    }));
  });

export const listAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const users = await listAllAuthUsers(supabaseAdmin);
    const roleRows = await fetchAllRows((from, to) =>
      supabaseAdmin.from("user_roles").select("user_id, role").range(from, to),
    );

    return users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      createdAt: u.created_at,
      roles: roleRows.filter((r) => r.user_id === u.id).map((r) => r.role as string),
    }));
  });

export const setAccountRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; role: string }) =>
    z.object({ userId: z.string().uuid(), role: roleSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.role !== "admin") {
      if (data.userId === ctx.userId) throw new Error("لا يمكنك إزالة صلاحية المدير عن حسابك");
      const { data: admins, error: adminsError } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      if (adminsError) throw adminsError;
      const adminIds = new Set((admins ?? []).map((r) => r.user_id));
      if (adminIds.has(data.userId) && adminIds.size <= 1) {
        throw new Error("لا يمكن إزالة آخر مدير للنظام");
      }
    }

    // Office employees are made by the office, through an invitation the account accepts: that is
    // what gives them an org_members row, and without one a "staff" account can see nothing.
    if (data.role === "staff" || data.role === "technician") {
      const { data: member, error: memberError } = await supabaseAdmin
        .from("org_members")
        .select("org_id")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (memberError) throw new Error("تعذّر التحقق من مكتب الحساب");
      if (!member) {
        throw new Error(
          "هذا الحساب ليس تابعًا لأي مكتب — يضيفه مدير المكتب من شاشة «فريق المكتب» ويقبل هو الدعوة",
        );
      }
    }

    // Add the new role first and only then drop the others, so a failure in between can never
    // leave the account with no role at all.
    const { error: addError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: data.userId, role: data.role },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (addError) throw addError;

    const { error: delError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .neq("role", data.role);
    if (delError) throw delError;

    // Demoting an employee to owner/tenant must also end their membership, or they keep their
    // office's rows through org_members while no longer being staff.
    if (data.role !== "staff" && data.role !== "technician" && data.role !== "admin") {
      const { error: leaveError } = await supabaseAdmin
        .from("org_members")
        .delete()
        .eq("user_id", data.userId);
      if (leaveError) throw new Error("تعذّر إنهاء عضوية الحساب في المكتب");
    }

    return { ok: true };
  });
