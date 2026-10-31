import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff, type ServerCtx } from "@/lib/server-context";

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
