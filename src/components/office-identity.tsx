import { BadgeCheck, Phone } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useOrgBranding } from "@/lib/use-org-branding";

/** بطاقة هوية المكتب: الشعار، الاسم، رقم ترخيص فال، رقم الجوال. */
export function OfficeIdentity() {
  const { org, logoDataUrl } = useOrgBranding();
  const o = org.data;
  if (!o) return null;

  return (
    <Card className="mb-6 shadow-deed">
      <CardContent className="flex flex-wrap items-center gap-4 py-5">
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt="شعار المكتب"
            className="h-14 w-14 rounded-md object-contain"
          />
        ) : null}
        <div className="min-w-40">
          <p className="font-display text-lg font-bold">{o.company_name}</p>
          <p className="text-sm text-muted-foreground">
            {[o.city, o.district].filter(Boolean).join(" · ") || o.address}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <BadgeCheck className="size-4 text-brass" />
            ترخيص فال: <span dir="ltr">{o.fal_license_no ?? "—"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Phone className="size-4 text-brass" />
            <span dir="ltr">{o.office_phone ?? "—"}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
