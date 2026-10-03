import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** The office the signed-in employee works for (null for owners, tenants and technicians). */
export async function myOrgId(): Promise<string | null> {
  const { data } = await supabase.rpc("my_org_id");
  return (data as string | null) ?? null;
}

/** إعدادات المنشأة (الاسم، الرقم الضريبي، السجل التجاري، شفرة المكتب، الشعار). */
export function useOrgBranding() {
  const org = useQuery({
    queryKey: ["org-branding"],
    queryFn: async () => {
      // Staff see their own office. Owners and tenants see the office(s) they work with: the oldest one.
      const mine = await myOrgId();
      let query = supabase
        .from("org_settings")
        .select(
          "id, company_name, vat_number, cr_number, office_code, vat_rate, address, logo_url, fal_license_no, office_phone, city, district, listed_publicly, whatsapp_locked, electricity_rate, water_rate, owner_approval_threshold",
        );
      query = mine ? query.eq("id", mine) : query.order("created_at", { ascending: true });
      const { data, error } = await query.limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const logoPath = org.data?.logo_url ?? null;
  const [logoDataUrl, setLogoDataUrl] = useState("");

  useEffect(() => {
    if (!logoPath) {
      setLogoDataUrl("");
      return;
    }
    void (async () => {
      const { data } = await supabase.storage.from("branding").download(logoPath);
      if (!data) return;
      const reader = new FileReader();
      reader.onload = () => setLogoDataUrl(String(reader.result ?? ""));
      reader.readAsDataURL(data);
    })();
  }, [logoPath]);

  return { org, logoDataUrl };
}
