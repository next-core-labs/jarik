import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/** بطاقة مؤشر رقمي بأيقونة — الوحدة المشتركة بين لوحات المؤشرات (الموظف/المالك/المستأجر/المدير العام). */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string | undefined;
  /** "warn" يبرز البطاقة (مستحقات متأخرة، صيانة تنتظر قرارًا…). */
  tone?: "default" | "warn" | undefined;
}) {
  return (
    <Card className={tone === "warn" ? "border-destructive/50 shadow-deed" : "shadow-deed"}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 truncate font-display text-3xl leading-none font-bold tabular-nums">
              {value}
            </p>
            {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
          </div>
          <span
            className={
              tone === "warn"
                ? "grid size-10 shrink-0 place-items-center rounded-md bg-destructive-tint text-destructive-tint-foreground"
                : "grid size-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"
            }
          >
            <Icon className="size-5" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
