import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Severity } from "@/components/owner-dashboard/model";

/** A titled dashboard section with the brand's deed rule under its heading. */
export function Section({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-20", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-lg font-bold leading-tight">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="deed-rule mb-4 mt-3" />
      {children}
    </section>
  );
}

/** A flat stone panel — the dashboard's one container style. */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("border border-border bg-card", className)}>{children}</div>;
}

/**
 * A thin meter in ink (not the brand red, which is reserved for actions and prices). The track is a
 * lighter step of the same ink so the whole bar reads as one scale.
 */
export function Meter({
  value,
  label,
  onInk = false,
  className,
}: {
  value: number;
  /** Accessible name, e.g. "نسبة الإشغال". */
  label: string;
  /** On the ink hero band: plaster fill on a dark track. */
  onInk?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-1.5 w-full", onInk ? "bg-sidebar-accent" : "bg-foreground/10", className)}
    >
      <div
        className={cn(
          "h-full transition-[width]",
          onInk ? "bg-sidebar-foreground" : "bg-foreground",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const SEVERITY: Record<Severity, { label: string; icon: typeof Info; tag: string }> = {
  critical: {
    label: "عاجل",
    icon: AlertOctagon,
    tag: "bg-destructive-tint text-destructive-tint-foreground",
  },
  warning: {
    label: "قريبًا",
    icon: AlertTriangle,
    tag: "bg-warning-tint text-warning-tint-foreground",
  },
  info: {
    label: "للمتابعة",
    icon: Info,
    tag: "bg-info-tint text-info-tint-foreground",
  },
};

/** Severity is never color alone: icon + word, with the color as a third cue. */
export function SeverityTag({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold",
        s.tag,
      )}
    >
      <s.icon className="size-3" aria-hidden />
      {s.label}
    </span>
  );
}

/** Label/value pair used in hero and panel stat rows. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-bold leading-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * A toggle chip for in-panel filters. Pressed state is carried by aria-pressed and by an ink fill —
 * not by the brand red, which stays reserved for actions.
 */
export function FilterChip({
  pressed,
  onClick,
  count,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 border px-3 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground hover:bg-background",
      )}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn("tabular-nums text-xs", pressed ? "opacity-80" : "text-muted-foreground")}
        >
          {count.toLocaleString("ar-SA")}
        </span>
      ) : null}
    </button>
  );
}
