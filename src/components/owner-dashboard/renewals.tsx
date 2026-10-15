import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck2, Check, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { arCount, daysLabel, daysUntil, sar, shortDate } from "@/lib/format";
import { toLatinDigits } from "@/lib/saudi-id";
import { cn } from "@/lib/utils";
import {
  monthLabel,
  yearAr,
  type OwnerUnit,
  type RenewalDecisionRow,
  type RenewalMonth,
} from "@/components/owner-dashboard/model";
import { Panel } from "@/components/owner-dashboard/parts";

/** Tallest column, in px; the value label sits above it, outside the plot height. */
const PLOT_PX = 136;

const compact = new Intl.NumberFormat("ar-SA", { notation: "compact", maximumFractionDigits: 1 });

function bucketLabel(b: RenewalMonth, long = false) {
  if (b.key === "expired") return "منتهية";
  const name = monthLabel(b.key, long ? "long" : "short");
  return long ? `${name} ${yearAr(b.key)}` : name;
}

/**
 * Lease renewals over the next 12 months: one column per month, its height the annual rent coming
 * up for renewal — magnitude in ink, single series, so no legend. Leases already past their end but
 * still active lead the strip, in the critical color with the word "منتهية" (never color alone).
 * Each column is a button: choosing it lists the units behind it. Time runs right-to-left.
 */
export type OwnerRenewalChoice = "renew" | "renew_new_rent" | "leave";
export type RenewalDecisionInput = {
  leaseId: string;
  decision: OwnerRenewalChoice;
  proposedRent?: number | undefined;
  note?: string | undefined;
};

const OWNER_DECISION_TEXT: Record<OwnerRenewalChoice, string> = {
  renew: "تجديد بنفس الإيجار",
  renew_new_rent: "تجديد بإيجار جديد",
  leave: "عدم التجديد",
};

export function Renewals({
  renewals,
  total,
  decisions,
  onDecide,
}: {
  renewals: RenewalMonth[];
  total: number;
  /** Per lease decisions; null when the renewal-decision service is unavailable. */
  decisions: Map<string, RenewalDecisionRow> | null;
  onDecide: (d: RenewalDecisionInput) => Promise<unknown>;
}) {
  const [dialog, setDialog] = useState<OwnerUnit | null>(null);
  // Leases ending within 90 days (or already ended) that have no decision from the owner yet.
  const awaiting = decisions
    ? renewals
        .flatMap((b) => b.units)
        .filter(
          (u) =>
            u.lease_id &&
            u.lease_end_date &&
            daysUntil(u.lease_end_date) <= 90 &&
            !decisions.get(u.lease_id)?.owner_decision,
        ).length
    : 0;
  const firstWithUnits = renewals.find((b) => b.units.length > 0)?.key ?? null;
  const [selected, setSelected] = useState<string | null>(firstWithUnits);
  const max = Math.max(1, ...renewals.map((b) => b.rent));
  const peak = renewals.reduce<RenewalMonth | null>(
    (best, b) => (b.rent > 0 && (!best || b.rent > best.rent) ? b : best),
    null,
  );
  const chosen = renewals.find((b) => b.key === selected) ?? null;

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="font-display font-bold">التجديدات القادمة</h3>
          <p className="text-sm text-muted-foreground">
            الإيجار السنوي للعقود التي تنتهي خلال ١٢ شهرًا · الإجمالي{" "}
            <span className="font-medium text-foreground">{sar(total)}</span>
          </p>
        </div>
        {awaiting > 0 ? (
          <p className="bg-foreground px-2.5 py-1 text-xs font-semibold text-background">
            {arCount(awaiting, {
              one: "عقد ينتظر قرارك",
              two: "عقدان ينتظران قرارك",
              few: "عقود تنتظر قرارك",
              many: "عقدًا ينتظر قرارك",
            })}
          </p>
        ) : null}
      </div>

      {total === 0 && !renewals.some((b) => b.units.length) ? (
        <p className="grid h-48 place-items-center px-5 text-sm text-muted-foreground">
          لا عقود تنتهي خلال الأشهر الاثني عشر القادمة.
        </p>
      ) : (
        <>
          <div
            className="mt-4 flex items-end gap-1 overflow-x-auto px-3 pb-1 sm:gap-2 sm:px-5"
            role="group"
            aria-label="التجديدات حسب الشهر"
          >
            {renewals.map((b) => {
              const expired = b.key === "expired";
              const on = b.key === selected;
              const empty = b.units.length === 0;
              const px = Math.max(6, Math.round((b.rent / max) * PLOT_PX));
              const labelled = !empty && (expired || b === peak || on);
              return (
                <button
                  key={b.key}
                  type="button"
                  disabled={empty}
                  aria-pressed={on}
                  aria-label={`${bucketLabel(b, true)}: ${
                    empty
                      ? "لا عقود"
                      : `${arCount(b.units.length, { one: "عقد واحد", two: "عقدان", few: "عقود", many: "عقدًا" })} بإيجار ${sar(b.rent)}`
                  }`}
                  onClick={() => setSelected(b.key)}
                  className={cn(
                    "group flex min-w-9 flex-1 flex-col items-center justify-end gap-1.5 pt-1",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    !empty && "cursor-pointer",
                  )}
                >
                  <span className="h-4 text-[11px] font-semibold tabular-nums text-foreground">
                    {labelled ? compact.format(b.rent) : null}
                  </span>
                  {/* Hit target is the whole column; the mark is thin with a 4px rounded data end. */}
                  <span className="flex w-full justify-center" style={{ height: PLOT_PX }}>
                    <span className="flex w-full max-w-7 items-end">
                      <span
                        className={cn(
                          "block w-full max-w-7 rounded-t-[4px] transition-opacity",
                          empty ? "bg-foreground/15" : expired ? "bg-destructive" : "bg-foreground",
                          !empty && !on && selected && "opacity-45 group-hover:opacity-80",
                        )}
                        style={{ height: empty ? 2 : px }}
                      />
                    </span>
                  </span>
                  <span
                    className={cn(
                      "whitespace-nowrap text-[11px]",
                      on ? "font-semibold text-foreground" : "text-muted-foreground",
                      expired && "font-semibold text-destructive",
                    )}
                  >
                    {bucketLabel(b)}
                  </span>
                  {/* The strip crosses a year end: January carries its year. */}
                  <span className="h-3 text-[10px] leading-none text-muted-foreground">
                    {b.key.endsWith("-01") ? yearAr(b.key) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {chosen && chosen.units.length > 0 ? (
            <div className="mt-3 border-t border-border">
              <p className="px-5 pt-4 text-sm font-medium">
                {chosen.key === "expired"
                  ? "عقود انتهت ولم تُجدَّد أو تُغلق"
                  : `عقود تنتهي في ${bucketLabel(chosen, true)}`}
                <span className="text-muted-foreground"> · {sar(chosen.rent)} سنويًا</span>
              </p>
              <ul className="divide-y divide-border px-5 pb-2">
                {chosen.units.map((u) => (
                  <RenewalRow
                    key={u.unit_id}
                    unit={u}
                    decision={u.lease_id ? (decisions?.get(u.lease_id) ?? null) : null}
                    canDecide={!!decisions && !!u.lease_id}
                    onAsk={() => setDialog(u)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <DecisionDialog
        key={dialog?.unit_id ?? "closed"}
        unit={dialog}
        current={dialog?.lease_id ? (decisions?.get(dialog.lease_id) ?? null) : null}
        onClose={() => setDialog(null)}
        onSubmit={async (d) => {
          try {
            await onDecide(d);
            setDialog(null);
          } catch {
            // The page shows the error; keep the dialog so nothing typed is lost.
          }
        }}
      />
    </Panel>
  );
}

function RenewalRow({
  unit: u,
  decision,
  canDecide,
  onAsk,
}: {
  unit: OwnerUnit;
  decision: RenewalDecisionRow | null;
  canDecide: boolean;
  onAsk: () => void;
}) {
  const days = u.lease_end_date ? daysUntil(u.lease_end_date) : 0;
  const mine = decision?.owner_decision ?? null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <CalendarCheck2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-medium">
          {u.property_name} · وحدة {u.unit_number}
          <span className="font-semibold tabular-nums"> · {sar(u.lease_annual_rent)}</span>
        </p>
        <p
          className={cn(
            "text-xs",
            days < 0 ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {days < 0
            ? `انتهى ${shortDate(u.lease_end_date)} — منذ ${daysLabel(days)}`
            : `ينتهي ${shortDate(u.lease_end_date)} — بعد ${daysLabel(days)}`}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {decision?.tenant_decision ? (
            <span className="flex items-center gap-1">
              <UserRound className="size-3.5" aria-hidden />
              المستأجر:{" "}
              <span className="font-medium">
                {decision.tenant_decision === "renew" ? "يرغب بالتجديد" : "لا يرغب بالتجديد"}
              </span>
            </span>
          ) : null}
          {mine ? (
            <span className="flex items-center gap-1">
              <Check className="size-3.5" aria-hidden />
              قرارك:{" "}
              <span className="font-medium">
                {OWNER_DECISION_TEXT[mine]}
                {mine === "renew_new_rent" && decision?.owner_proposed_rent
                  ? ` (${sar(decision.owner_proposed_rent)})`
                  : ""}
              </span>
              <span className="text-muted-foreground">
                {decision?.owner_status === "handled" ? "· عالجه المكتب" : "· وصل للمكتب"}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      {canDecide ? (
        <Button size="sm" variant={mine ? "outline" : "default"} onClick={onAsk}>
          {mine ? "غيّر قرارك" : "حدّد قرارك"}
        </Button>
      ) : (
        <Button size="sm" variant="outline" asChild>
          <Link to="/messages">{days < 0 ? "اطلب التسوية" : "ناقش التجديد"}</Link>
        </Button>
      )}
    </li>
  );
}

function DecisionDialog({
  unit,
  current,
  onClose,
  onSubmit,
}: {
  unit: OwnerUnit | null;
  current: RenewalDecisionRow | null;
  onClose: () => void;
  onSubmit: (d: RenewalDecisionInput) => Promise<void>;
}) {
  const [choice, setChoice] = useState<OwnerRenewalChoice>(current?.owner_decision ?? "renew");
  const [rent, setRent] = useState(
    String(current?.owner_proposed_rent ?? unit?.lease_annual_rent ?? ""),
  );
  const [note, setNote] = useState(current?.owner_note ?? "");
  const [pending, setPending] = useState(false);
  const rentValue = Number(rent);
  const valid = choice !== "renew_new_rent" || (Number.isFinite(rentValue) && rentValue > 0);

  const options: { value: OwnerRenewalChoice; title: string; hint: string }[] = [
    {
      value: "renew",
      title: "جدّد بنفس الإيجار",
      hint: unit ? `${sar(unit.lease_annual_rent)} سنويًا` : "",
    },
    { value: "renew_new_rent", title: "جدّد بإيجار جديد", hint: "حدّد المبلغ السنوي" },
    {
      value: "leave",
      title: "لا أرغب بالتجديد",
      hint: "يتولّى المكتب إشعار المستأجر وتسوية العقد",
    },
  ];

  return (
    <Dialog open={!!unit} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>قرارك في تجديد العقد</DialogTitle>
          <DialogDescription>
            {unit
              ? `${unit.property_name} · وحدة ${unit.unit_number} — ينتهي ${shortDate(unit.lease_end_date)}`
              : null}
          </DialogDescription>
        </DialogHeader>
        {current?.tenant_decision ? (
          <p className="border border-border bg-card px-4 py-2.5 text-sm">
            المستأجر{" "}
            <span className="font-semibold">
              {current.tenant_decision === "renew" ? "يرغب بالتجديد" : "لا يرغب بالتجديد"}
            </span>
          </p>
        ) : null}
        <div role="radiogroup" aria-label="القرار" className="grid gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={choice === o.value}
              onClick={() => setChoice(o.value)}
              className={cn(
                "flex items-center gap-3 border px-4 py-3 text-start transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                choice === o.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:bg-background",
              )}
            >
              <span
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border",
                  choice === o.value ? "border-background" : "border-foreground/50",
                )}
                aria-hidden
              >
                {choice === o.value ? <span className="size-2 rounded-full bg-background" /> : null}
              </span>
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span
                  className={cn(
                    "block text-xs",
                    choice === o.value ? "text-background/70" : "text-muted-foreground",
                  )}
                >
                  {o.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
        {choice === "renew_new_rent" ? (
          <div className="space-y-2">
            <label htmlFor="renewal-rent" className="text-sm text-muted-foreground">
              الإيجار السنوي الجديد (ر.س)
            </label>
            <Input
              id="renewal-rent"
              inputMode="numeric"
              dir="ltr"
              value={rent}
              onChange={(e) => setRent(toLatinDigits(e.target.value).replace(/\D/g, ""))}
            />
            {unit?.lease_annual_rent && rentValue > 0 ? (
              <p className="text-xs text-muted-foreground">
                {rentValue === Number(unit.lease_annual_rent)
                  ? "نفس الإيجار الحالي"
                  : `${rentValue > Number(unit.lease_annual_rent) ? "زيادة" : "خفض"} ${sar(Math.abs(rentValue - Number(unit.lease_annual_rent)))} عن الحالي`}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2">
          <label htmlFor="renewal-note" className="text-sm text-muted-foreground">
            ملاحظة للمكتب (اختياري)
          </label>
          <Textarea
            id="renewal-note"
            rows={2}
            maxLength={400}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button
            disabled={!valid || pending || !unit?.lease_id}
            onClick={async () => {
              if (!unit?.lease_id) return;
              setPending(true);
              await onSubmit({
                leaseId: unit.lease_id,
                decision: choice,
                proposedRent: choice === "renew_new_rent" ? rentValue : undefined,
                note: note.trim() || undefined,
              });
              setPending(false);
            }}
          >
            {pending ? "جارٍ الإرسال…" : "أرسل قرارك للمكتب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
