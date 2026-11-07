import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Wallet,
  Wrench,
  FileWarning,
  TrendingUp,
  DoorOpen,
  Zap,
  Droplets,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { OwnerRentRequests } from "@/components/owner-rent-requests";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, todayRiyadh } from "@/lib/dates";
import {
  arCount,
  arNum,
  arPct,
  daysLabel,
  daysUntil,
  maintenanceStatusLabel,
  sar,
  shortDate,
} from "@/lib/format";
import { useOrgBranding } from "@/lib/use-org-branding";

export const Route = createFileRoute("/_authenticated/dashboard")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "لوحة المؤشرات — جارك" },
      { name: "description", content: "الإشغال والتحصيل والمصروفات والصيانة والعقود المنتهية." },
      { property: "og:title", content: "لوحة المؤشرات — جارك" },
      { property: "og:description", content: "مؤشرات الأملاك والتحصيل والصيانة في مكان واحد." },
    ],
  }),
  component: Dashboard,
});

type OfficeTotals = {
  collected: number;
  outstanding: number;
  overdue_count: number;
  expenses_total: number;
  units_total: number;
  units_occupied: number;
  units_vacant: number;
};

function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      // Totals are summed in the database and the lists are bounded, so nothing here depends on
      // how many payments or units the office has (PostgREST returns at most 1000 rows).
      const today = todayRiyadh();
      const [totals, overdue, maintenance, openMaintenance, leases, readings] = await Promise.all([
        supabase.rpc("office_finance_summary"),
        supabase.rpc("office_payments", { _status: "overdue", _limit: 10 }),
        supabase
          .from("maintenance_requests")
          .select("id, title, status, priority, created_at")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("maintenance_requests")
          .select("id", { count: "exact", head: true })
          .neq("status", "done"),
        supabase
          .from("leases")
          .select("id, end_date, status, annual_rent")
          .eq("status", "active")
          .lte("end_date", addDays(today, 90))
          .order("end_date")
          .limit(50),
        supabase
          .from("meter_readings")
          .select(
            "id, unit_id, meter_type, reading, reading_date, units(unit_number, properties(name))",
          )
          .order("reading_date", { ascending: false })
          .limit(400),
      ]);
      if (totals.error) throw totals.error;
      return {
        totals: totals.data as unknown as OfficeTotals,
        overdue: overdue.data ?? [],
        maintenance: maintenance.data ?? [],
        openMaintenance: openMaintenance.count ?? 0,
        leases: leases.data ?? [],
        readings: readings.data ?? [],
      };
    },
  });
}

function Dashboard() {
  const { data, isLoading } = useDashboard();
  const { org, logoDataUrl } = useOrgBranding();

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="لوحة المؤشرات" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </>
    );
  }

  // A sold unit has left the rental pool: it must not be counted as vacant, and it must not
  // silently deflate the occupancy rate as more units sell over time (units_total excludes it).
  const total = Number(data.totals.units_total);
  const occupied = Number(data.totals.units_occupied);
  const vacant = Number(data.totals.units_vacant);
  const occupancy = total ? Math.round((occupied / total) * 100) : 0;

  const collected = Number(data.totals.collected);
  const outstanding = Number(data.totals.outstanding);
  const overdueCount = Number(data.totals.overdue_count);
  const overdue = data.overdue;
  const expensesTotal = Number(data.totals.expenses_total);
  const expiringSoon = data.leases;

  type Reading = (typeof data.readings)[number];
  const byUnitMeter = new Map<string, Reading[]>();
  for (const r of data.readings) {
    const key = `${r.unit_id}|${r.meter_type}`;
    const list = byUnitMeter.get(key) ?? [];
    list.push(r);
    byUnitMeter.set(key, list);
  }
  const consumption = [...byUnitMeter.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => b.reading_date.localeCompare(a.reading_date));
      const latest = sorted[0]!;
      const previous = sorted[1];
      return {
        key: `${latest.unit_id}|${latest.meter_type}`,
        meterType: latest.meter_type,
        unitLabel: `${latest.units?.properties?.name ?? "—"} · وحدة ${latest.units?.unit_number ?? "—"}`,
        readingDate: latest.reading_date,
        latest: Number(latest.reading),
        used: previous ? Number(latest.reading) - Number(previous.reading) : null,
      };
    })
    .sort((a, b) => (b.used ?? 0) - (a.used ?? 0));

  const numberFmt = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 });
  /** One meter card. Usage needs two readings of a meter, so until then the value is "—" rather
   * than a "٠" that reads as a stray dot and suggests nothing was used. */
  const meterCard = (water: boolean) => {
    const meters = consumption.filter((c) => (c.meterType === "water") === water);
    const measured = meters.filter((c) => c.used !== null);
    const lastDate = meters.reduce<string | null>(
      (latest, c) => (latest && latest > c.readingDate ? latest : c.readingDate),
      null,
    );
    return {
      value: measured.length
        ? numberFmt.format(measured.reduce((s, c) => s + Math.max(c.used ?? 0, 0), 0))
        : "—",
      hint: !lastDate
        ? "لا توجد قراءات بعد"
        : measured.length
          ? `آخر قراءة ${shortDate(lastDate)}`
          : "يظهر الاستهلاك بعد القراءة الثانية",
    };
  };
  const electricity = meterCard(false);
  const water = meterCard(true);

  return (
    <>
      <PageHeader
        title="لوحة المؤشرات"
        subtitle="صورة كاملة للإشغال والتحصيل والصيانة والعقود — تتحدّث تلقائيًا."
      />

      <Card className="shadow-deed">
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          {logoDataUrl ? (
            <img src={logoDataUrl} alt="شعار المكتب" className="h-12 w-auto" />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              شعار
            </div>
          )}
          <div>
            <p className="font-medium">{org.data?.company_name ?? "مكتبنا"}</p>
            <p className="text-sm text-muted-foreground">
              شفرة المكتب:{" "}
              <span dir="ltr" className="font-medium text-foreground">
                {org.data?.office_code ?? "—"}
              </span>
              {org.data?.vat_number ? (
                <>
                  {" · "}الرقم الضريبي: <span dir="ltr">{org.data.vat_number}</span>
                </>
              ) : null}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          icon={Building2}
          label="نسبة الإشغال"
          value={arPct(occupancy)}
          hint={`${arNum(occupied)} مشغولة من ${arCount(total, { one: "وحدة واحدة", two: "وحدتين", few: "وحدات", many: "وحدة" })}`}
        />
        <StatCard icon={DoorOpen} label="الوحدات الشاغرة" value={vacant} hint="جاهزة للتأجير" />
        <StatCard
          icon={Wallet}
          label="المحصّل"
          value={sar(collected)}
          hint="مجموع الدفعات المسددة"
        />
        <StatCard
          icon={FileWarning}
          label="المستحق غير المحصّل"
          value={sar(outstanding)}
          hint={
            overdueCount
              ? arCount(overdueCount, {
                  one: "دفعة متأخرة واحدة",
                  two: "دفعتان متأخرتان",
                  few: "دفعات متأخرة",
                  many: "دفعة متأخرة",
                })
              : "لا توجد دفعات متأخرة"
          }
        />
        <StatCard
          icon={TrendingUp}
          label="المصروفات"
          value={sar(expensesTotal)}
          hint="صيانة وتشغيل"
        />
        <StatCard
          icon={Wrench}
          label="الصيانة المفتوحة"
          value={data.openMaintenance}
          hint="طلبات لم تُنجز"
        />
        <StatCard
          icon={Zap}
          label="استهلاك الكهرباء"
          value={electricity.value}
          hint={electricity.hint}
        />
        <StatCard icon={Droplets} label="استهلاك المياه" value={water.value} hint={water.hint} />
      </div>

      <div className="mt-6">
        <OwnerRentRequests />
      </div>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">استهلاك العدادات لكل وحدة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {consumption.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              سجّل قراءة واحدة على الأقل لكل عداد ليظهر الاستهلاك هنا تلقائيًا.
            </p>
          ) : (
            consumption.slice(0, 8).map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between border-b border-border pb-2 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium">{c.unitLabel}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.meterType === "water" ? "مياه" : "كهرباء"} · آخر قراءة{" "}
                    {shortDate(c.readingDate)}
                  </p>
                </div>
                <Badge variant={c.used === null ? "outline" : "secondary"}>
                  {c.used === null
                    ? `القراءة ${numberFmt.format(c.latest)}`
                    : `استهلاك ${numberFmt.format(Math.max(c.used, 0))}`}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="shadow-deed lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">الإشغال</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={occupancy} />
            <p className="mt-3 text-sm text-muted-foreground">
              {arNum(occupied)} مشغولة · {arNum(vacant)} شاغرة
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-deed lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">عقود تنتهي خلال ٩٠ يومًا</CardTitle>
            <Link
              to="/tenants"
              className="text-sm text-foreground underline underline-offset-4 hover:text-red-text"
            >
              كل العقود
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {expiringSoon.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد عقود قريبة الانتهاء.</p>
            ) : (
              expiringSoon.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between border-b border-border pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">عقد ينتهي {shortDate(l.end_date)}</p>
                    <p className="text-xs text-muted-foreground">إيجار سنوي {sar(l.annual_rent)}</p>
                  </div>
                  <Badge variant="outline">{leaseEndsIn(daysUntil(l.end_date))}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="shadow-deed">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">أحدث طلبات الصيانة</CardTitle>
            <Link
              to="/maintenance"
              className="text-sm text-foreground underline underline-offset-4 hover:text-red-text"
            >
              الصيانة
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.maintenance.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between border-b border-border pb-2 last:border-0"
              >
                <p className="text-sm">{m.title}</p>
                {/* "default" (red) is reserved for price/primary action/available — a maintenance
                    status is none of those. */}
                <Badge variant={m.status === "done" ? "secondary" : "outline"}>
                  {maintenanceStatusLabel[m.status] ?? m.status}
                </Badge>
              </div>
            ))}
            {data.maintenance.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد طلبات.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="shadow-deed">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">
              المتأخرات
              {overdueCount > overdue.length
                ? ` (أقدم ${arNum(overdue.length)} من ${arNum(overdueCount)})`
                : ""}
            </CardTitle>
            <Link
              to="/collections"
              className="text-sm text-foreground underline underline-offset-4 hover:text-red-text"
            >
              التحصيل
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {overdue.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد متأخرات.</p>
            ) : (
              overdue.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between border-b border-border pb-2 last:border-0"
                >
                  <p className="text-sm">استحقاق {shortDate(p.due_date)}</p>
                  <span className="text-sm font-medium text-destructive">
                    {sar(Number(p.amount) - Number(p.amount_paid))}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** «بعد ١٢ يومًا» — or «ينتهي اليوم» / «انتهى منذ يومين» for an active lease past its end date. */
function leaseEndsIn(days: number) {
  if (days === 0) return "ينتهي اليوم";
  return days < 0 ? `انتهى منذ ${daysLabel(days)}` : `بعد ${daysLabel(days)}`;
}
