import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { arNum, arPct, sar } from "@/lib/format";
import { Panel } from "@/components/owner-dashboard/parts";
import type { DistrictBenchmark } from "@/components/owner-dashboard/model";

/**
 * Your asking rent against the district's, per district you own in. Neutral ink, not good/bad
 * colors: above-market is not automatically good for an owner (it can mean longer vacancy).
 */
export function MarketBenchmark({ benchmarks }: { benchmarks: DistrictBenchmark[] }) {
  return (
    <Panel className="h-full">
      <div className="px-5 pt-5">
        <h3 className="font-display font-bold">إيجارك مقارنة بالحي</h3>
        <p className="text-sm text-muted-foreground">
          متوسط الإيجار السنوي المطلوب لوحداتك مقابل الحي
        </p>
      </div>
      {benchmarks.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          لا تتوفر بيانات كافية عن أحيائك بعد — نعرض الحي عند توفر 3 وحدات فأكثر فيه.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {benchmarks.map((b) => {
            const Arrow = b.deltaPct > 0 ? ArrowUpRight : b.deltaPct < 0 ? ArrowDownRight : Minus;
            const scale = Math.max(b.myAvgRent, b.marketAvgRent) || 1;
            return (
              <li key={b.district} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{b.district}</p>
                  <p className="flex items-center gap-1 text-sm font-semibold">
                    <Arrow className="size-4" aria-hidden />
                    {b.deltaPct === 0
                      ? "مطابق لمتوسط الحي"
                      : `${arPct(Math.abs(b.deltaPct))} ${b.deltaPct > 0 ? "فوق" : "دون"} متوسط الحي`}
                  </p>
                </div>
                {/* Two thin bars on one shared scale — the comparison at a glance, numbers beside. */}
                <div className="mt-3 space-y-2 text-xs">
                  <BenchBar
                    label={`وحداتك (${arNum(b.myUnits)})`}
                    value={b.myAvgRent}
                    scale={scale}
                    strong
                  />
                  <BenchBar
                    label={`الحي (${arNum(b.marketUnits)})`}
                    value={b.marketAvgRent}
                    scale={scale}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  إشغال الحي {arPct(b.marketOccupancyPct)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function BenchBar({
  label,
  value,
  scale,
  strong = false,
}: {
  label: string;
  value: number;
  scale: number;
  strong?: boolean;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="h-2 bg-foreground/10">
        <span
          className={strong ? "block h-full bg-foreground" : "block h-full bg-foreground/45"}
          style={{ width: `${Math.round((value / scale) * 100)}%` }}
        />
      </span>
      <span className="tabular-nums font-medium">{sar(value)}</span>
    </div>
  );
}
