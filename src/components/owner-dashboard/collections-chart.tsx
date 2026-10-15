import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import { BarChart3, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { sar } from "@/lib/format";
import { monthLabel, type ChartPoint } from "@/components/owner-dashboard/model";
import { Panel } from "@/components/owner-dashboard/parts";

// Emphasis encoding, not categorical: past months in ink, the current (still running) month in
// the brand red. Validated with the dataviz skill's validate_palette.js against both card surfaces
// (light #eae9e9, dark #26241f): CVD ΔE ≥ 27 and ≥ 3:1 contrast. Identity is never color alone —
// the current month also carries a direct label and a legend key.
const CHART_CONFIG: ChartConfig = {
  collected: { label: "محصّل", color: "var(--foreground)" },
  current: { label: "الشهر الحالي", color: "var(--primary)" },
};

const compact = new Intl.NumberFormat("ar-SA", { notation: "compact", maximumFractionDigits: 1 });

export function CollectionsChart({ points, total }: { points: ChartPoint[]; total: number }) {
  const [asTable, setAsTable] = useState(false);
  const data = points.map((p) => ({ ...p, month: monthLabel(p.key) }));
  const maxValue = Math.max(0, ...points.map((p) => p.collected));
  // Label selectively: the current month and the best month — never every bar.
  const labelled = new Set(
    points
      .filter((p) => p.current || (p.collected > 0 && p.collected === maxValue))
      .map((p) => p.key),
  );

  return (
    <Panel className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="font-display font-bold">التحصيل الشهري</h3>
          <p className="text-sm text-muted-foreground">
            آخر ٦ أشهر · الإجمالي <span className="font-medium text-foreground">{sar(total)}</span>
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="text-muted-foreground"
        >
          {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
          {asTable ? "عرض كرسم" : "عرض كجدول"}
        </Button>
      </div>

      <div className="flex-1 px-3 pb-4 pt-2">
        {total === 0 ? (
          <p className="grid h-60 place-items-center text-sm text-muted-foreground">
            لم يُسجَّل تحصيل في آخر ٦ أشهر.
          </p>
        ) : asTable ? (
          <table className="mx-2 mt-2 w-[calc(100%-1rem)] text-sm">
            <caption className="sr-only">التحصيل الشهري لآخر ٦ أشهر</caption>
            <thead>
              <tr className="border-b border-border text-start text-xs text-muted-foreground">
                <th scope="col" className="py-2 text-start font-normal">
                  الشهر
                </th>
                <th scope="col" className="py-2 text-end font-normal">
                  المحصّل
                </th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.key} className="border-b border-border last:border-0">
                  <td className="py-2">
                    {monthLabel(p.key, "long")} {p.key.slice(0, 4)}
                    {p.current ? (
                      <span className="text-xs text-muted-foreground"> · حتى اليوم</span>
                    ) : null}
                  </td>
                  <td className="py-2 text-end tabular-nums">{sar(p.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            {/* SVG pinned to LTR: under the page's RTL, tick text grows into the plot instead of the
                axis gutter. Bar order is still right-to-left (XAxis reversed); the HTML tooltip
                stays RTL. */}
            <ChartContainer config={CHART_CONFIG} className="h-60 w-full [&_svg]:[direction:ltr]">
              <BarChart data={data} margin={{ top: 24, left: 4, right: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                {/* RTL: time runs right-to-left, with the value axis on the right edge. */}
                <XAxis dataKey="month" reversed tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis
                  orientation="right"
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  tickCount={4}
                  tick={{ style: { fontVariantNumeric: "tabular-nums" } }}
                  tickFormatter={(v: number) => compact.format(v)}
                />
                <ChartTooltip
                  cursor={{ fill: "var(--foreground)", fillOpacity: 0.05 }}
                  content={
                    <ChartTooltipContent
                      hideIndicator
                      labelFormatter={(_label, payload) => {
                        const p = payload?.[0]?.payload as
                          (ChartPoint & { month: string }) | undefined;
                        return p
                          ? `${monthLabel(p.key, "long")}${p.current ? " (حتى اليوم)" : ""}`
                          : "";
                      }}
                      formatter={(value) => (
                        <div className="flex flex-1 justify-between gap-6">
                          <span className="text-muted-foreground">محصّل</span>
                          <span className="font-medium">{sar(Number(value))}</span>
                        </div>
                      )}
                    />
                  }
                />
                {/* No grow-in animation: it replays on every refetch (noise), and Recharts hides the
                    direct labels until it finishes. */}
                <Bar
                  dataKey="collected"
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                >
                  {data.map((p) => (
                    <Cell
                      key={p.key}
                      fill={p.current ? "var(--color-current)" : "var(--color-collected)"}
                    />
                  ))}
                  <LabelList
                    dataKey="collected"
                    content={({ x, y, width, value, index }) => {
                      const p = typeof index === "number" ? data[index] : undefined;
                      if (!p || !labelled.has(p.key) || x == null || y == null || width == null)
                        return null;
                      return (
                        <text
                          x={Number(x) + Number(width) / 2}
                          y={Number(y) - 8}
                          textAnchor="middle"
                          className="fill-foreground text-[11px] font-semibold"
                        >
                          {compact.format(Number(value))}
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
            <div
              className="mt-1 flex flex-wrap gap-4 px-2 text-xs text-muted-foreground"
              aria-hidden
            >
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 bg-foreground" />
                الأشهر السابقة
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 bg-primary" />
                الشهر الحالي (حتى اليوم)
              </span>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
