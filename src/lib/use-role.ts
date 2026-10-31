import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "staff" | "owner" | "tenant" | "technician" | "super_admin";

export const roleLabel: Record<AppRole, string> = {
  // Legacy platform-wide role, retired (20261101100000_single_system_admin): nobody holds it now.
  admin: "مدير (صلاحية ملغاة)",
  staff: "موظف / محاسب",
  owner: "مالك",
  tenant: "مستأجر",
  technician: "فني",
  super_admin: "مدير النظام",
};

export function useMyRoles() {
  return useQuery({
    queryKey: ["my-roles"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return { userId: null as string | null, roles: [] as AppRole[] };
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      if (error) throw error;
      return { userId, roles: (data ?? []).map((r) => r.role as AppRole) };
    },
  });
}

export function isStaffRole(roles: AppRole[] | undefined) {
  return !!roles?.some((r) => r === "admin" || r === "staff");
}
