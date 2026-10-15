import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, FileSpreadsheet, MessagesSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { arCount, arNum, arPct, sar } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Meter } from "@/components/owner-dashboard/parts";
import {
  attentionHeadline,
  type DashboardModel,
  type Finance,
  type Office,
} from "@/components/owner-dashboard/model";

/** صباح الخير before noon in Riyadh, مساء الخير after. */
function greeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Riyadh",
    }).format(now),
  );
  return hour >= 4 && hour < 12 ? "صباح الخير" : "مساء الخير";
}

function longDate(iso: string) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The ink band that opens the dashboard: one hero figure (net income, the number an owner cares
 * about most), the facts that qualify it, and — when something is waiting — the first thing to do.
 */
export function OwnerHero({
  model,
  finance,
  offices,
  downloading,
  onDownload,
  onExportExcel,
}: {
  model: DashboardModel;
  finance: Finance;
  offices: Office[];
  downloading: boolean;
  onDownload: () => void;
  onExportExcel: () => void;
}) {
  const top = model.attention[0];
  const rest = model.attention.length - 1;
  return (
    <section aria-labelledby="owner-hero-title" className="bg-sidebar text-sidebar-foreground">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-sidebar-border px-5 py-5 md:px-8">
        <div className="min-w-0">
          <p className="text-sm text-sidebar-foreground/70">
            {greeting()}
            {finance.today ? ` · ${longDate(finance.today)}` : null}
          </p>
          <h1
            id="owner-hero-title"
            className="mt-1 font-display text-2xl font-bold leading-tight md:text-3xl"
          >
            لوحة المالك
          </h1>
          {model.hasUnits ? (
            <p className="mt-1 text-sm text-sidebar-foreground/70">
              {arCount(model.properties.length, {
                one: "عقار واحد",
                two: "عقاران",
                few: "عقارات",
                many: "عقارًا",
              })}{" "}
              ·{" "}
              {arCount(model.unitsCount, {
                one: "وحدة واحدة",
                two: "وحدتان",
                few: "وحدات",
                many: "وحدة",
              })}
              {offices.length === 1 ? ` · يديرها ${offices[0]!.company_name}` : null}
              {offices.length > 1
                ? ` · ${arCount(offices.length, { one: "مكتب", two: "مكتبان", few: "مكاتب", many: "مكتبًا" })} تدير أملاكك`
                : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            asChild
            className="border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Link to="/messages">
              <MessagesSquare aria-hidden />
              راسل المكتب
            </Link>
          </Button>
          {model.hasUnits ? (
            <>
              <Button
                variant="outline"
                onClick={onExportExcel}
                className="border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <FileSpreadsheet aria-hidden />
                Excel
              </Button>
              <Button disabled={downloading} onClick={onDownload}>
                <Download aria-hidden />
                {downloading ? "جارٍ إنشاء الملف…" : "كشف الحساب PDF"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {model.hasUnits ? (
        <>
          <div className="grid gap-8 px-5 py-7 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] md:px-8 md:py-9">
            <div className="min-w-0">
              <p className="text-sm text-sidebar-foreground/70">صافي دخلك — آخر ١٢ شهرًا</p>
              {/* Hero figure: same sans as everything else, proportional digits, never truncated. */}
              <p className="mt-3 break-words font-display text-4xl font-extrabold leading-none sm:text-5xl lg:text-6xl">
                {sar(model.net12m)}
              </p>
              <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <div className="flex gap-1.5">
                  <dt className="text-sidebar-foreground/60">محصّل</dt>
                  <dd className="font-semibold tabular-nums">{sar(finance.collected_12m)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-sidebar-foreground/60">مصروفات</dt>
                  <dd className="font-semibold tabular-nums">{sar(finance.expenses_12m)}</dd>
                </div>
                {model.netMarginPct !== null ? (
                  <div className="flex gap-1.5">
                    <dt className="text-sidebar-foreground/60">هامش الصافي</dt>
                    <dd className="font-semibold">{arPct(model.netMarginPct)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <dl className="grid content-start gap-x-6 gap-y-5 sm:grid-cols-2 md:border-s md:border-sidebar-border md:ps-8">
              <div className="sm:col-span-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-sidebar-foreground/70">الإشغال</dt>
                  <dd className="font-display text-xl font-bold">{arPct(model.occupancyPct)}</dd>
                </div>
                <Meter value={model.occupancyPct} label="نسبة الإشغال" onInk className="mt-2" />
                <p className="mt-1.5 text-xs text-sidebar-foreground/60">
                  مؤجرة {arNum(model.occupied)} من {arNum(model.rentable)}
                </p>
              </div>
              <HeroFact
                label="الإيجار المتعاقد سنويًا"
                value={sar(model.contractedRent)}
                hint="حسب العقود السارية"
              />
              <HeroFact
                label="مستحق خلال ٣٠ يومًا"
                value={sar(finance.upcoming_30_total)}
                hint="دفعات لم يحن موعدها"
              />
              <HeroFact
                label="متأخرات"
                value={sar(finance.overdue_total)}
                hint={
                  finance.overdue_count > 0
                    ? arCount(finance.overdue_count, {
                        one: "دفعة واحدة فات موعدها",
                        two: "دفعتان فات موعدهما",
                        few: "دفعات فات موعدها",
                        many: "دفعة فات موعدها",
                      })
                    : "لا يوجد"
                }
                alert={finance.overdue_count > 0}
              />
              <HeroFact
                label="تجديدات خلال ١٢ شهرًا"
                value={sar(model.renewalsRent)}
                hint="إيجار سنوي يحين تجديده"
              />
            </dl>
          </div>

          {top ? (
            <a
              href="#approvals"
              className="group flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-sidebar-border bg-sidebar-accent px-5 py-3.5 text-sm transition-colors hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring md:px-8"
            >
              <span
                className={cn(
                  "size-2 shrink-0",
                  top.severity === "critical"
                    ? "bg-[#f0739f]"
                    : top.severity === "warning"
                      ? "bg-warning"
                      : "bg-sidebar-foreground/50",
                )}
                aria-hidden
              />
              <span className="text-sidebar-foreground/70">أهم ما ينتظرك:</span>
              <span className="min-w-0 basis-full font-medium sm:flex-1 sm:basis-0 sm:truncate">
                {attentionHeadline(top)}
              </span>
              {rest > 0 ? (
                <span className="text-sidebar-foreground/70">
                  و
                  {arCount(rest, {
                    one: "أمر آخر",
                    two: "أمران آخران",
                    few: "أمور أخرى",
                    many: "أمرًا آخر",
                  })}
                </span>
              ) : null}
              <span className="flex items-center gap-1 font-semibold">
                ابدأ
                <ArrowLeft
                  className="size-4 transition-transform group-hover:-translate-x-0.5"
                  aria-hidden
                />
              </span>
            </a>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function HeroFact({
  label,
  value,
  hint,
  alert = false,
}: {
  label: string;
  value: string;
  hint: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0 border-t border-sidebar-border pt-4">
      <dt className="text-sm text-sidebar-foreground/70">{label}</dt>
      <dd className="mt-1 font-display text-lg font-bold leading-tight">{value}</dd>
      <dd
        className={cn(
          "mt-0.5 text-xs",
          // The ink band is dark in both themes, so the dark-surface danger tone (pomegranate,
          // never brand red) is pinned rather than taken from --destructive, which is light-mode ink.
          alert ? "font-medium text-[#f0739f]" : "text-sidebar-foreground/60",
        )}
      >
        {hint}
      </dd>
    </div>
  );
}
