import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type OrgRow = Database["public"]["Tables"]["org_settings"]["Row"];

/**
 * An office's settings as this account may see them. Owners and tenants get only the public identity
 * (my_linked_offices()); the rest (VAT/CR numbers, rates, thresholds…) is for the office's own people.
 */
export type OrgBranding = Pick<
  OrgRow,
  | "id"
  | "company_name"
  | "fal_license_no"
  | "office_phone"
  | "city"
  | "district"
  | "address"
  | "logo_url"
> &
  Partial<OrgRow>;

/** The office the signed-in employee or technician works for (null for owners and tenants). */
export async function myOrgId(): Promise<string | null> {
  const { data } = await supabase.rpc("my_org_id");
  return (data as string | null) ?? null;
}

/** إعدادات المنشأة (الاسم، الرقم الضريبي، السجل التجاري، شفرة المكتب، الشعار). */
export function useOrgBranding() {
  const org = useQuery({
    queryKey: ["org-branding"],
    queryFn: async (): Promise<OrgBranding | null> => {
      // Staff and technicians see their own office. Owners and tenants see the public identity of
      // the office(s) they work with, the oldest one: org_settings itself is closed to them.
      const mine = await myOrgId();
      if (!mine) {
        const { data, error } = await supabase.rpc("my_linked_offices");
        if (error) throw error;
        return data?.[0] ?? null;
      }
      const { data, error } = await supabase
        .from("org_settings")
        .select(
          "id, company_name, vat_number, cr_number, office_code, vat_rate, address, logo_url, fal_license_no, office_phone, city, district, listed_publicly, whatsapp_locked, electricity_rate, water_rate, owner_approval_threshold",
        )
        .eq("id", mine)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const logoDataUrl = useBrandingLogo(org.data?.logo_url ?? null);

  return { org, logoDataUrl };
}

/**
 * An office logo from the private `branding` bucket as a data URL ("" until loaded or when there is
 * none). A data URL, not a signed URL, so it also renders inside PDFs built from the DOM.
 */
export function useBrandingLogo(logoPath: string | null) {
  const [logoDataUrl, setLogoDataUrl] = useState("");

  useEffect(() => {
    if (!logoPath) {
      setLogoDataUrl("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.storage.from("branding").download(logoPath);
      if (!data || cancelled) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (!cancelled) setLogoDataUrl(String(reader.result ?? ""));
      };
      reader.readAsDataURL(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [logoPath]);

  return logoDataUrl;
}
