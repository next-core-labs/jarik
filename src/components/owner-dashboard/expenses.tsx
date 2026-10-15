import { useState } from "react";

import { arCount, arPct, sar, shortDate } from "@/lib/format";
import type { ExpenseCategory, ExpenseRow } from "@/components/owner-dashboard/model";
import { Panel } from "@/components/owner-dashboard/parts";

/**
 * Where the money went over 12 months: one ink bar per category on a shared scale (magnitude,
 * single series — no legend, the category names label the bars), then the latest items.
 */
export function ExpensesBreakdown({
  categories,
  total,
  rows,
}: {
  categories: ExpenseCategory[];
  total: number;
  rows: ExpenseRow[];
}) {
  const [showAll, setShowAll] = useState(false);
  const max = Math.max(1, ...categories.map((c) => c.total));
  const items = showAll ? rows : rows.slice(0, 3);

  return (
    <Panel className="flex h-full flex-col">
      <div className="px-5 pt-5">
        <h3 className="font-display font-bold">المصروفات حسب البند</h3>
        <p className="text-sm text-muted-foreground">
          آخر ١٢ شهرًا · الإجمالي <span className="font-medium text-foreground">{sar(total)}</span>
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="grid flex-1 place-items-center px-5 py-12 text-sm text-muted-foreground">
          لا مصروفات مسجّلة على أملاكك في آخر ١٢ شهرًا.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-3 px-5">
            {categories.map((c) => (
              <li key={c.category}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">
                    {c.category}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {arCount(c.count, { one: "بند", two: "بندان", few: "بنود", many: "بندًا" })}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {sar(c.total)}
                    <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                      {arPct(Math.round((c.total / (total || 1)) * 100))}
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 bg-foreground/10" aria-hidden>
                  <div
                    className="h-full rounded-e-[4px] bg-foreground"
                    style={{ width: `${Math.max(2, (c.total / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-border">
            <p className="px-5 pt-3 text-xs text-muted-foreground">أحدث المصروفات</p>
            <ul className="divide-y divide-border px-5">
              {items.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {shortDate(e.expense_date)}
                      {e.property_name ? ` · ${e.property_name}` : ""}
                      {e.unit_number ? ` · وحدة ${e.unit_number}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">{sar(e.amount)}</span>
                </li>
              ))}
            </ul>
            {rows.length > 3 ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="w-full border-t border-border px-5 py-2.5 text-sm font-medium hover:bg-background"
              >
                {showAll ? "عرض أقل" : `عرض الكل (${rows.length.toLocaleString("ar-SA")})`}
              </button>
            ) : (
              <div className="pb-2" />
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
