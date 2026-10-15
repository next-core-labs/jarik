import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  DoorOpen,
  HeartPulse,
  ListChecks,
  Wallet,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { arCount, arNum, daysLabel, priorityLabel, sar, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Meter, Panel, Section, SeverityTag } from "@/components/owner-dashboard/parts";
import type {
  Approval,
  AttentionItem,
  DashboardModel,
  Severity,
} from "@/components/owner-dashboard/model";

// Severity edge on each row: the third cue after the icon and the word (see SeverityTag).
const EDGE: Record<Severity, string> = {
  critical: "border-s-destructive",
  warning: "border-s-warning",
  info: "border-s-border",
};

export type Decision = { requestId: string; approved: boolean; note?: string | undefined };

type Filter = "all" | AttentionItem["kind"];

const FILTERS: { kind: AttentionItem["kind"]; label: string; icon: typeof Wrench }[] = [
  { kind: "approval", label: "موافقات صيانة", icon: Wrench },
  { kind: "overdue", label: "إيجارات متأخرة", icon: Wallet },
  { kind: "lease", label: "عقود تنتهي", icon: CalendarClock },
  { kind: "vacant", label: "وحدات شاغرة", icon: DoorOpen },
];

/**
 * Everything waiting on the owner, in one ranked list. Beside it, the portfolio health score and
 * what moves it — each factor doubles as a filter for the list. Each row: severity (icon + word +
 * edge color), what happened, and the one next step.
 */
export function AttentionCenter({
  model,
  deciding,
  onDecide,
  autoApproveLimit,
}: {
  model: DashboardModel;
  /** The request id currently being decided, if any. */
  deciding: string | null;
  onDecide: (d: Decision) => Promise<unknown>;
  /** The owner's maintenance auto-approve limit; null = every approval waits for them. */
  autoApproveLimit: number | null;
}) {
  const [dialog, setDialog] = useState<{ approval: Approval; approved: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const { health, attention } = model;

  // The underlying quantity per factor (payments, units…), not the number of rows.
  const factor = (kind: AttentionItem["kind"]) => {
    const items = attention.filter((i) => i.kind === kind);
    let count = items.length;
    let hint: string | null = null;
    for (const i of items) {
      if (i.kind === "overdue") {
        count = i.count;
        hint = `بإجمالي ${sar(i.total)}`;
      }
      if (i.kind === "vacant") count = i.units.length;
    }
    if (kind === "approval" && items.length) {
      const cost = items.reduce(
        (s, i) => s + (i.kind === "approval" ? Number(i.approval.cost) : 0),
        0,
      );
      hint = `بتكلفة ${sar(cost)}`;
    }
    if (kind === "lease" && items.length) {
      const expired = items.filter((i) => i.kind === "lease" && i.days < 0).length;
      hint = expired ? `${arNum(expired)} منتهٍ لم يُجدَّد` : "خلال ٦٠ يومًا";
    }
    return { count, hint };
  };
  const visible = filter === "all" ? attention : attention.filter((i) => i.kind === filter);

  return (
    <Section
      id="approvals"
      title="يحتاج انتباهك"
      description={
        attention.length
          ? `${arCount(attention.length, { one: "أمر واحد", two: "أمران", few: "أمور", many: "أمرًا" })} مرتبة حسب الأولوية — الأعجل أولًا`
          : "كل شيء تحت السيطرة"
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Panel className="flex flex-col">
          <div className="px-5 py-5">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <HeartPulse className="size-4" aria-hidden />
              صحة المحفظة
            </p>
            <p className="mt-2 font-display text-4xl font-extrabold leading-none">
              {arNum(health.score)}
              <span className="text-base font-normal text-muted-foreground">/١٠٠</span>
            </p>
            <Meter value={health.score} label="صحة المحفظة" className="mt-3" />
            <p className="mt-3 text-sm leading-relaxed">{health.summary}</p>
          </div>
          {attention.length > 0 ? (
            <div className="border-t border-border p-2" role="group" aria-label="تصفية القائمة">
              <FactorButton
                pressed={filter === "all"}
                onClick={() => setFilter("all")}
                icon={ListChecks}
                label="الكل"
                count={attention.length}
              />
              {FILTERS.map((f) => {
                const { count, hint } = factor(f.kind);
                if (count === 0) return null;
                return (
                  <FactorButton
                    key={f.kind}
                    pressed={filter === f.kind}
                    onClick={() => setFilter(filter === f.kind ? "all" : f.kind)}
                    icon={f.icon}
                    label={f.label}
                    count={count}
                    hint={hint}
                  />
                );
              })}
            </div>
          ) : null}
          <div className="mt-auto flex items-start gap-2 border-t border-border px-5 py-3.5 text-xs">
            <BadgeCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">
              {autoApproveLimit
                ? `نوافق نيابةً عنك على الصيانة حتى ${sar(autoApproveLimit)}، ونُشعرك بها.`
                : "كل صيانة تتجاوز حد المكتب تنتظر موافقتك."}{" "}
              <Link
                to="/owner/settings"
                hash="auto-approve"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {autoApproveLimit ? "تعديل الحد" : "فعّل الموافقة التلقائية"}
              </Link>
            </p>
          </div>
        </Panel>

        <Panel>
          {attention.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-5 py-12 text-center">
              <CheckCircle2 className="size-9 text-success" aria-hidden />
              <p className="font-display text-lg font-bold">لا شيء يحتاج انتباهك الآن</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                لا موافقات معلّقة، ولا متأخرات، ولا عقود تنتهي قريبًا، ولا وحدات شاغرة.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border" aria-live="polite">
              {visible.map((item) => (
                <li key={item.key} className={cn("border-s-4 px-5 py-4", EDGE[item.severity])}>
                  <AttentionRow
                    item={item}
                    deciding={deciding}
                    onAsk={(approval, approved) => setDialog({ approval, approved })}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <DecisionDialog
        // Remount per request so a note typed for one decision never carries over to the next.
        key={dialog ? `${dialog.approval.id}-${dialog.approved}` : "closed"}
        state={dialog}
        pending={!!dialog && deciding === dialog.approval.id}
        onClose={() => setDialog(null)}
        onConfirm={async (note) => {
          if (!dialog) return;
          try {
            await onDecide({ requestId: dialog.approval.id, approved: dialog.approved, note });
            setDialog(null);
          } catch {
            // The page shows the server's message; keep the dialog open so the note isn't lost.
          }
        }}
      />
    </Section>
  );
}

function FactorButton({
  pressed,
  onClick,
  icon: Icon,
  label,
  count,
  hint,
}: {
  pressed: boolean;
  onClick: () => void;
  icon: typeof Wrench;
  label: string;
  count: number;
  hint?: string | null;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        pressed ? "bg-foreground text-background" : "hover:bg-background",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? (
          <span
            className={cn(
              "block text-xs",
              pressed ? "text-background/70" : "text-muted-foreground",
            )}
          >
            {hint}
          </span>
        ) : null}
      </span>
      <span className="font-display text-sm font-bold tabular-nums">{arNum(count)}</span>
    </button>
  );
}

function RowShell({
  icon: Icon,
  item,
  title,
  meta,
  children,
  action,
}: {
  icon: typeof Wrench;
  item: AttentionItem;
  title: React.ReactNode;
  meta: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <span className="grid size-9 shrink-0 place-items-center bg-background" aria-hidden>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityTag severity={item.severity} />
          <p className="font-medium">{title}</p>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{meta}</p>
        {children}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

function AttentionRow({
  item,
  deciding,
  onAsk,
}: {
  item: AttentionItem;
  deciding: string | null;
  onAsk: (approval: Approval, approved: boolean) => void;
}) {
  switch (item.kind) {
    case "approval": {
      const a = item.approval;
      const busy = deciding === a.id;
      return (
        <RowShell
          icon={Wrench}
          item={item}
          title={a.title}
          meta={`صيانة تنتظر موافقتك · ${a.property_name} · وحدة ${a.unit_number} · ${priorityLabel[a.priority] ?? a.priority} · طُلب ${shortDate(a.created_at)}`}
          action={
            <>
              <Button size="sm" disabled={busy} onClick={() => onAsk(a, true)}>
                موافقة
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onAsk(a, false)}>
                رفض
              </Button>
            </>
          }
        >
          {a.description ? <p className="mt-2 text-sm">{a.description}</p> : null}
          <p className="mt-2 text-sm">
            التكلفة المقدّرة <span className="price">{sar(a.cost)}</span>
          </p>
        </RowShell>
      );
    }
    case "overdue":
      return (
        <RowShell
          icon={Wallet}
          item={item}
          title={arCount(item.count, {
            one: "دفعة إيجار متأخرة",
            two: "دفعتا إيجار متأخرتان",
            few: "دفعات إيجار متأخرة",
            many: "دفعة إيجار متأخرة",
          })}
          meta={`بإجمالي ${sar(item.total)} — المكتب يتابع التحصيل، ويمكنك الاستفسار عن خطته.`}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/messages">تابع مع المكتب</Link>
            </Button>
          }
        />
      );
    case "lease": {
      const u = item.unit;
      const when =
        item.days < 0
          ? `انتهى منذ ${daysLabel(item.days)} ولم يُجدَّد أو يُغلق`
          : item.days === 0
            ? "ينتهي اليوم"
            : `ينتهي ${shortDate(u.lease_end_date)} — بعد ${daysLabel(item.days)}`;
      return (
        <RowShell
          icon={CalendarClock}
          item={item}
          title={`عقد ${u.property_name} · وحدة ${u.unit_number}`}
          meta={when}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/messages">{item.days < 0 ? "اطلب التسوية" : "ناقش التجديد"}</Link>
            </Button>
          }
        />
      );
    }
    case "vacant":
      return (
        <RowShell
          icon={DoorOpen}
          item={item}
          title={arCount(item.units.length, {
            one: "وحدة شاغرة",
            two: "وحدتان شاغرتان",
            few: "وحدات شاغرة",
            many: "وحدة شاغرة",
          })}
          meta={item.units.map((u) => `${u.property_name} · ${u.unit_number}`).join("، ")}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link to="/messages">اطلب تسويقها</Link>
            </Button>
          }
        />
      );
  }
}

function DecisionDialog({
  state,
  pending,
  onClose,
  onConfirm,
}: {
  state: { approval: Approval; approved: boolean } | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (note: string | undefined) => void;
}) {
  const [note, setNote] = useState("");
  const a = state?.approval;
  return (
    <Dialog
      open={!!state}
      onOpenChange={(open) => {
        if (!open) {
          setNote("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.approved ? "تأكيد الموافقة على الصيانة" : "رفض طلب الصيانة"}
          </DialogTitle>
          <DialogDescription>
            {a ? `${a.title} — ${a.property_name} · وحدة ${a.unit_number}` : null}
          </DialogDescription>
        </DialogHeader>
        {a ? (
          <div className="flex items-baseline justify-between border border-border bg-card px-4 py-3">
            <span className="text-sm text-muted-foreground">التكلفة المقدّرة</span>
            <span className="price text-xl">{sar(a.cost)}</span>
          </div>
        ) : null}
        <div className="space-y-2">
          <label htmlFor="decision-note" className="text-sm text-muted-foreground">
            {state?.approved
              ? "ملاحظة للمكتب (اختياري) — مثل: «أرسلوا الفاتورة بعد التنفيذ»"
              : "سبب الرفض (اختياري) — مثل: «اطلبوا عرض سعر آخر»"}
          </label>
          <Textarea
            id="decision-note"
            rows={3}
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
            variant={state?.approved ? "default" : "destructive"}
            disabled={pending}
            onClick={() => onConfirm(note.trim() || undefined)}
          >
            {pending
              ? "جارٍ التسجيل…"
              : state?.approved
                ? `أوافق على ${a ? sar(a.cost) : ""}`
                : "تأكيد الرفض"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
