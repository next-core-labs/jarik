import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** Who manages a unit right now, as the database decides it (unit_management()). */
export type UnitManagement = {
  officeId: string;
  officeName: string;
  /** The office registered the property itself (not through a management agreement). */
  registered: boolean;
  /** The live agreement's grants; false for a registered unit. */
  pricing: boolean;
  leasing: boolean;
};

/**
 * The managing office of each unit the caller owns or whose office the caller works in. A unit with
 * no office (or no live agreement) is simply absent from the map.
 */
export function useUnitManagement(unitIds: string[]) {
  const ids = [...new Set(unitIds)].sort();
  return useQuery({
    queryKey: ["unit-management", ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Map<string, UnitManagement>> => {
      const { data, error } = await supabase.rpc("unit_management", { _unit_ids: ids });
      if (error) throw error;
      const map = new Map<string, UnitManagement>();
      for (const r of data ?? []) {
        if (!r.office_id) continue;
        map.set(r.unit_id, {
          officeId: r.office_id,
          officeName: r.office_name || "مكتب",
          registered: r.registered,
          pricing: r.pricing,
          leasing: r.leasing,
        });
      }
      return map;
    },
  });
}
