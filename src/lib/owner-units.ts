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

/**
 * Units under an agreement that still holds — the same rule as request_management_agreement:
 * status 'active' and no termination, or its notice period not over yet. `status` stays 'active'
 * after the notice period ends (it is computed live, not stored), so status alone would keep such a
 * unit excluded forever after the server already accepts a new request for it.
 */
export function activeAgreementUnitIds(
  agreements: {
    status: string;
    termination_requested_at: string | null;
    notice_period_days: number;
    agreement_units: { unit_id: string }[];
  }[],
  now = Date.now(),
): Set<string> {
  const s = new Set<string>();
  for (const a of agreements) {
    if (a.status !== "active") continue;
    if (
      a.termination_requested_at &&
      now >= new Date(a.termination_requested_at).getTime() + a.notice_period_days * 86400000
    ) {
      continue;
    }
    for (const au of a.agreement_units) s.add(au.unit_id);
  }
  return s;
}
