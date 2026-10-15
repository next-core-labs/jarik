import { BadgeCheck, Building, Phone } from "lucide-react";

import { arNum } from "@/lib/format";
import { useBrandingLogo } from "@/lib/use-org-branding";
import { Panel } from "@/components/owner-dashboard/parts";
import type { Office } from "@/components/owner-dashboard/model";

/** The offices that actually manage the owner's units (property office + active agreements). */
export function OfficesList({ offices }: { offices: Office[] }) {
  return (
    <Panel className="h-full">
      <div className="px-5 pt-5">
        <h3 className="font-display font-bold">
          {offices.length === 1 ? "المكتب الذي يدير وحداتك" : "المكاتب التي تدير وحداتك"}
        </h3>
        <p className="text-sm text-muted-foreground">جهات الاتصال المرخّصة لأملاكك</p>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {offices.map((o) => (
          <OfficeRow key={o.id} office={o} />
        ))}
      </ul>
    </Panel>
  );
}

function OfficeRow({ office: o }: { office: Office }) {
  const logo = useBrandingLogo(o.logo_url);
  return (
    <li className="flex items-center gap-3 px-5 py-4">
      {logo ? (
        <img src={logo} alt="" className="size-10 shrink-0 bg-background object-contain" />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center bg-background" aria-hidden>
          <Building className="size-5 text-muted-foreground" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{o.company_name}</p>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>يدير {arNum(o.units_count)} من وحداتك</span>
          <span className="flex items-center gap-1">
            <BadgeCheck className="size-3.5" aria-hidden />
            فال <span dir="ltr">{o.fal_license_no ?? "—"}</span>
          </span>
        </p>
      </div>
      {o.office_phone ? (
        <a
          href={`tel:${o.office_phone}`}
          aria-label={`اتصل بـ${o.company_name}`}
          className="grid size-9 shrink-0 place-items-center border border-border hover:bg-background"
        >
          <Phone className="size-4" aria-hidden />
        </a>
      ) : null}
    </li>
  );
}
