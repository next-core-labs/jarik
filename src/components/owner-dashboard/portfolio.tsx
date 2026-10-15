import { useState } from "react";
import { Building2, LayoutGrid, MapPin, Search, Table2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { arNum, arPct, daysLabel, daysUntil, sar, shortDate, unitStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FilterChip, Meter, Panel } from "@/components/owner-dashboard/parts";
import type { OwnerUnit, PropertyGroup } from "@/components/owner-dashboard/model";

// Unit status marks: ink = let, outline = vacant, amber = maintenance, faded = sold. Always paired
// with the status word in the row; the strip in each card also carries it as a tooltip.
const STATUS_DOT: Record<string, string> = {
  occupied: "bg-foreground",
  vacant: "bg-transparent ring-1 ring-inset ring-foreground",
  maintenance: "bg-warning",
  sold: "bg-muted-foreground/40",
};

const STATUS_ORDER = ["occupied", "vacant", "maintenance", "sold"];

type View = "cards" | "table";

/**
 * Every property and unit, filterable by status and searchable by unit or property, as cards
 * (occupancy and 12-month return per property) or as one flat table.
 */
export function Portfolio({
  properties,
  statusCounts,
  onLocate,
}: {
  properties: PropertyGroup[];
  statusCounts: Record<string, number>;
  /** Show a property on the map section; only offered for properties with coordinates. */
  onLocate: (propertyId: string) => void;
}) {
  const [status, setStatus] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("cards");

  const q = query.trim().toLowerCase();
  const matches = (p: PropertyGroup, u: OwnerUnit) =>
    (status === "all" || u.status === status) &&
    (!q ||
      u.unit_number.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (u.unit_type ?? "").toLowerCase().includes(q) ||
      (p.district ?? "").toLowerCase().includes(q));

  const filtered = properties
    .map((p) => ({ property: p, units: p.units.filter((u) => matches(p, u)) }))
    .filter((g) => g.units.length > 0);
  const total = Object.values(statusCounts).reduce((s, n) => s + n, 0);
  const shown = filtered.reduce((s, g) => s + g.units.length, 0);
  const filtering = status !== "all" || q !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none]"
          role="group"
          aria-label="تصفية حسب الحالة"
        >
          <FilterChip pressed={status === "all"} onClick={() => setStatus("all")} count={total}>
            الكل
          </FilterChip>
          {STATUS_ORDER.filter((s) => statusCounts[s]).map((s) => (
            <FilterChip
              key={s}
              pressed={status === s}
              onClick={() => setStatus(status === s ? "all" : s)}
              count={statusCounts[s]}
            >
              <span className={cn("size-2", STATUS_DOT[s])} aria-hidden />
              {unitStatusLabel[s] ?? s}
            </FilterChip>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث برقم الوحدة أو العقار أو الحي"
            aria-label="بحث في الوحدات"
            className="h-8 ps-8"
          />
        </div>
        <div className="flex border border-border" role="group" aria-label="طريقة العرض">
          <ViewButton on={view === "cards"} onClick={() => setView("cards")} label="بطاقات">
            <LayoutGrid className="size-4" aria-hidden />
          </ViewButton>
          <ViewButton on={view === "table"} onClick={() => setView("table")} label="جدول">
            <Table2 className="size-4" aria-hidden />
          </ViewButton>
        </div>
      </div>

      {filtering ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {arNum(shown)} من {arNum(total)} وحدة
          <button
            type="button"
            onClick={() => {
              setStatus("all");
              setQuery("");
            }}
            className="ms-2 inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            <X className="size-3.5" aria-hidden />
            مسح التصفية
          </button>
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <Panel className="px-5 py-12 text-center text-sm text-muted-foreground">
          لا توجد وحدات تطابق التصفية.
        </Panel>
      ) : view === "cards" ? (
        // Masonry columns, not a grid: a two-unit property must not stretch to a ten-unit neighbour.
        <div className={cn("gap-4", filtered.length > 1 && "xl:columns-2")}>
          {filtered.map((g) => (
            <PropertyCard
              key={g.property.id}
              property={g.property}
              units={g.units}
              onLocate={g.property.location ? () => onLocate(g.property.id) : undefined}
            />
          ))}
        </div>
      ) : (
        <UnitsTable groups={filtered} />
      )}
    </div>
  );
}

function ViewButton({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        on ? "bg-foreground text-background" : "bg-card hover:bg-background",
      )}
    >
      {children}
    </button>
  );
}

function PropertyCard({
  property: p,
  units,
  onLocate,
}: {
  property: PropertyGroup;
  units: OwnerUnit[];
  onLocate?: (() => void) | undefined;
}) {
  const r = p.returns;
  return (
    <Panel className="mb-4 flex break-inside-avoid flex-col">
      <div className="flex flex-wrap items-start gap-3 px-5 pt-5">
        <span
          className="grid size-10 shrink-0 place-items-center bg-sidebar text-sidebar-foreground"
          aria-hidden
        >
          <Building2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-bold leading-tight">{p.name}</h3>
          {p.city || p.district ? (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[p.city, p.district].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        {onLocate ? (
          <Button size="sm" variant="ghost" onClick={onLocate} className="text-muted-foreground">
            <MapPin aria-hidden />
            على الخريطة
          </Button>
        ) : null}
      </div>

      <div className="mx-5 mt-4">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>
            الإشغال · مؤجرة {arNum(p.occupied)} من {arNum(p.rentable)}
          </span>
          <span className="font-display text-sm font-bold text-foreground">
            {arPct(p.occupancyPct)}
          </span>
        </div>
        <Meter value={p.occupancyPct} label={`نسبة إشغال ${p.name}`} className="mt-1.5" />
        {/* One square per unit — the building's make-up at a glance. */}
        <ul className="mt-3 flex flex-wrap gap-1" aria-label={`حالة وحدات ${p.name}`}>
          {p.units.map((u) => (
            <li
              key={u.unit_id}
              title={`وحدة ${u.unit_number} · ${unitStatusLabel[u.status] ?? u.status}`}
              className={cn("size-3", STATUS_DOT[u.status] ?? "bg-muted-foreground")}
            >
              <span className="sr-only">
                وحدة {u.unit_number}: {unitStatusLabel[u.status] ?? u.status}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {r ? (
        <dl className="mx-5 mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-border border-y border-border py-3 text-center">
          <div className="px-2">
            <dt className="text-[11px] text-muted-foreground">صافي ١٢ شهرًا</dt>
            <dd className="mt-0.5 font-display text-sm font-bold">{sar(r.net_12m)}</dd>
          </div>
          <div className="px-2">
            <dt className="text-[11px] text-muted-foreground">من الإيجار السنوي</dt>
            <dd className="mt-0.5 font-display text-sm font-bold">{arPct(Number(r.net_pct))}</dd>
          </div>
          <div className="px-2">
            <dt className="text-[11px] text-muted-foreground">المصروفات</dt>
            <dd className="mt-0.5 font-display text-sm font-bold">{sar(r.expenses_12m)}</dd>
          </div>
        </dl>
      ) : null}

      <ul className="mt-2 divide-y divide-border px-5 pb-3">
        {units.map((u) => (
          <UnitRow key={u.unit_id} unit={u} />
        ))}
      </ul>
    </Panel>
  );
}

function leaseNote(u: OwnerUnit) {
  if (!u.lease_end_date) return { text: "", late: false };
  const days = daysUntil(u.lease_end_date);
  if (days < 0) return { text: `انتهى العقد ${shortDate(u.lease_end_date)}`, late: true };
  if (days <= 60) return { text: `العقد ينتهي بعد ${daysLabel(days)}`, late: false };
  return { text: `العقد حتى ${shortDate(u.lease_end_date)}`, late: false };
}

function UnitRow({ unit: u }: { unit: OwnerUnit }) {
  const note = leaseNote(u);
  const rent = u.lease_id ? u.lease_annual_rent : u.annual_rent;
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <span
        className={cn("size-2 shrink-0", STATUS_DOT[u.status] ?? "bg-muted-foreground")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-medium">وحدة {u.unit_number}</span>
          <span className="text-muted-foreground"> · {u.unit_type}</span>
        </p>
        <p
          className={cn(
            "text-xs",
            note.late ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {unitStatusLabel[u.status] ?? u.status}
          {note.text ? ` · ${note.text}` : ""}
        </p>
      </div>
      {u.status !== "sold" ? (
        <p className="shrink-0 text-end">
          <span className="font-semibold tabular-nums">{sar(rent)}</span>
          <span className="block text-[11px] text-muted-foreground">
            {u.lease_id ? "سنويًا حسب العقد" : "الإيجار المطلوب"}
          </span>
        </p>
      ) : null}
    </li>
  );
}

function UnitsTable({ groups }: { groups: { property: PropertyGroup; units: OwnerUnit[] }[] }) {
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">وحداتك</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 text-start font-normal">
              الوحدة
            </th>
            <th scope="col" className="px-4 py-3 text-start font-normal">
              العقار
            </th>
            <th scope="col" className="px-4 py-3 text-start font-normal">
              الحالة
            </th>
            <th scope="col" className="px-4 py-3 text-start font-normal">
              العقد
            </th>
            <th scope="col" className="px-4 py-3 text-end font-normal">
              الإيجار السنوي
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap(({ property: p, units }) =>
            units.map((u) => {
              const note = leaseNote(u);
              const rent = u.lease_id ? u.lease_annual_rent : u.annual_rent;
              return (
                <tr
                  key={u.unit_id}
                  className="border-b border-border last:border-0 hover:bg-background/60"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium">{u.unit_number}</span>
                    <span className="block text-xs text-muted-foreground">{u.unit_type}</span>
                  </td>
                  <td className="px-4 py-3">
                    {p.name}
                    {p.district ? (
                      <span className="block text-xs text-muted-foreground">{p.district}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={cn(
                          "size-2 shrink-0",
                          STATUS_DOT[u.status] ?? "bg-muted-foreground",
                        )}
                        aria-hidden
                      />
                      {unitStatusLabel[u.status] ?? u.status}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-xs",
                      note.late ? "font-medium text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {note.text || "—"}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {u.status === "sold" ? (
                      "—"
                    ) : (
                      <>
                        <span className="font-semibold">{sar(rent)}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {u.lease_id ? "حسب العقد" : "مطلوب"}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </Panel>
  );
}
