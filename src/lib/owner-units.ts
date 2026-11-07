import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { PropertyWithUnits } from "@/components/request-agreement-dialog";

/**
 * Every unit this owner owns, grouped by property — owner_units(), not properties→units: same
 * ownership rule as request_management_agreement (the unit's own owner, else the property's), so an
 * owner of a single unit inside an office's property still gets it (properties RLS hides that property).
 */
export function useOwnerUnitGroups() {
  return useQuery({
    queryKey: ["owner-agreements-properties"],
    queryFn: async (): Promise<PropertyWithUnits[]> => {
      const { data, error } = await supabase.rpc("owner_units");
      if (error) throw error;
      const byProperty = new Map<
        string,
        PropertyWithUnits & { units: NonNullable<PropertyWithUnits["units"]> }
      >();
      for (const u of data ?? []) {
        const p = byProperty.get(u.property_id) ?? {
          id: u.property_id,
          name: u.property_name,
          city: u.city,
          district: u.district,
          units: [],
        };
        p.units.push({
          id: u.unit_id,
          unit_number: u.unit_number,
          unit_type: u.unit_type,
          status: u.status,
        });
        byProperty.set(u.property_id, p);
      }
      return [...byProperty.values()];
    },
  });
}
