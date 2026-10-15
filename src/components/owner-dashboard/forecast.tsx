import { sar } from "@/lib/format";
import { cn } from "@/lib/utils";
import { monthLabel, yearAr, type ForecastPoint } from "@/components/owner-dashboard/model";
import { Panel } from "@/components/owner-dashboard/parts";

/** Tallest column, in px. */
const PLOT_PX = 170;

const compact = new Intl.NumberFormat("ar-SA", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Rent falling due over the next 6 months, from the lease payment schedules. Each column is what
 * falls due that month: the collected part in solid ink, the rest outlined — two encodings, not
 * two colors, so the split reads in any color vision and in print. Time runs right-to-left.
 */
export function CashflowForecast({
  points,
  outstanding,
}: {
  points: ForecastPoint[];
  outstanding: number;
}) {
  const max = Math.max(1, ...points.map((p) => p.due));
  const peak = points.reduce<ForecastPoint | null>(
    (best, p) => (p.due > 0 && (!best || p.due > best.due) ? p : best),
    null,
  );
  const total = points.reduce((s, p) => s + p.due, 0);

  return (
    <Panel className="flex h-full flex-col">
      <div className="px-5 pt-5">
        <h3 className="font-display font-bold">التدفق المتوقع</h3>
        <p className="text-sm text-muted-foreground">
          ما يستحق من إيجار خلال ٦ أشهر حسب جداول الدفعات
        </p>
      </div>

      {total > 0 ? (
        <dl className="mx-5 mt-4 grid grid-cols-3 divide-x divide-x-reverse divide-border border-y border-border py-3 text-center">
          <div className="px-2">
            <dt className="text-[11px] text-muted-foreground">مستحق خلال ٦ أشهر</dt>
            <dd className="mt-0.5 font-display text-sm font-bold">{sar(total)}</dd>
          </div>
          <div className="px-2">
            <dt className="text-[11px] text-muted-foreground">حُصّل منه</dt>
            <dd className="mt-0.5 font-display text-sm font-bold">{sar(total - outstanding)}</dd>
          </div>
          <div className="px-2">
            <dt className="text-[11px] text-muted-foreground">المتبقي للتحصيل</dt>
            <dd className="mt-0.5 font-display text-sm font-bold">{sar(outstanding)}</dd>
          </div>
        </dl>
      ) : null}

      {total === 0 ? (
        <p className="grid flex-1 place-items-center px-5 py-12 text-sm text-muted-foreground">
          لا دفعات مجدولة في الأشهر الستة القادمة.
        </p>
      ) : (
        <>
          <ul
            className="mt-4 flex flex-1 items-end gap-2 px-5"
            aria-label="الإيجار المستحق حسب الشهر"
          >
            {points.map((p) => {
              const height = p.due ? Math.max(6, Math.round((p.due / max) * PLOT_PX)) : 2;
              const paidShare = p.due ? Math.min(1, p.paid / p.due) : 0;
              const labelled = p.due > 0 && (p.current || p === peak);
              return (
                <li
                  key={p.key}
                  className="group relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
                >
                  <span className="sr-only">
                    {monthLabel(p.key, "long")}: مستحق {sar(p.due)}، حُصّل {sar(p.paid)}
                  </span>
                  <span className="h-4 text-[11px] font-semibold tabular-nums" aria-hidden>
                    {labelled ? compact.format(p.due) : null}
                  </span>
                  <span
                    className="flex w-full justify-center"
                    style={{ height: PLOT_PX }}
                    aria-hidden
                  >
                    <span className="flex w-full max-w-9 flex-col justify-end">
                      {p.due === 0 ? (
                        <span className="block h-[2px] bg-foreground/15" />
                      ) : (
                        <span
                          className="flex flex-col justify-end overflow-hidden rounded-t-[4px]"
                          style={{ height }}
                        >
                          {/* Outstanding on top (outlined), collected at the base (solid), with
                              a 2px surface gap between them. */}
                          {paidShare < 1 ? (
                            <span className="block flex-1 rounded-t-[4px] border-[1.5px] border-b-0 border-foreground/70 bg-foreground/[0.06]" />
                          ) : null}
                          {paidShare > 0 ? (
                            <span
                              className={cn(
                                "block bg-foreground",
                                paidShare < 1 ? "mt-[2px]" : "rounded-t-[4px]",
                              )}
                              style={{ height: `${paidShare * 100}%` }}
                            />
                          ) : null}
                        </span>
                      )}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "whitespace-nowrap text-[11px]",
                      p.current ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {p.current ? "هذا الشهر" : monthLabel(p.key)}
                  </span>
                  {/* Hover/focus detail, above the column. */}
                  {p.due > 0 ? (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max min-w-36 border border-border bg-popover px-3 py-2 text-xs shadow-sm group-hover:block"
                    >
                      <span className="block font-semibold">
                        {monthLabel(p.key, "long")} {yearAr(p.key)}
                      </span>
                      <span className="mt-1 flex justify-between gap-4">
                        <span className="text-muted-foreground">مستحق</span>
                        {sar(p.due)}
                      </span>
                      <span className="flex justify-between gap-4">
                        <span className="text-muted-foreground">حُصّل</span>
                        {sar(p.paid)}
                      </span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div
            className="mt-3 flex flex-wrap gap-4 px-5 pb-5 text-xs text-muted-foreground"
            aria-hidden
          >
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 bg-foreground" />
              حُصّل
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 border-[1.5px] border-foreground/70 bg-foreground/[0.06]" />
              لم يُحصَّل بعد
            </span>
          </div>
        </>
      )}
    </Panel>
  );
}
