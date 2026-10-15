import { AlertOctagon, CheckCircle2, Clock } from "lucide-react";

import { effectiveStatus } from "@/lib/dates";
import { paymentStatusLabel, sar, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/owner-dashboard/parts";
import type { RecentPayment } from "@/components/owner-dashboard/model";

const STATUS_STYLE: Record<string, { icon: typeof Clock; className: string }> = {
  paid: { icon: CheckCircle2, className: "text-success" },
  overdue: { icon: AlertOctagon, className: "text-destructive" },
  due: { icon: Clock, className: "text-muted-foreground" },
};

/** Payment activity up to today (the RPC already leaves future instalments out). */
export function RecentPayments({ payments, today }: { payments: RecentPayment[]; today: string }) {
  return (
    <Panel className="flex h-full flex-col">
      <div className="px-5 pt-5">
        <h3 className="font-display font-bold">آخر المدفوعات</h3>
        <p className="text-sm text-muted-foreground">حتى اليوم، الأحدث أولًا</p>
      </div>
      {payments.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">لا توجد دفعات بعد.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {payments.map((p) => {
            const status = effectiveStatus(p, today || undefined);
            const s = STATUS_STYLE[status] ?? STATUS_STYLE["due"]!;
            return (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                <s.icon className={cn("size-4 shrink-0", s.className)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {p.property_name} · {p.unit_number}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {status === "paid" && p.paid_date
                      ? `سُدّدت ${shortDate(p.paid_date)}`
                      : `استحقت ${shortDate(p.due_date)}`}
                  </p>
                </div>
                <div className="shrink-0 text-end">
                  <p className="text-sm font-semibold tabular-nums">{sar(p.amount)}</p>
                  <p className={cn("text-xs font-medium", s.className)}>
                    {paymentStatusLabel[status] ?? status}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
