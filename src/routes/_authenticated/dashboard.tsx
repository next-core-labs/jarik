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
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { isOverdue } from "@/lib/dates";
import { sar, shortDate, daysUntil, maintenanceStatusLabel } from "@/lib/format";
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

function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [units, payments, maintenance, leases, expenses, readings] = await Promise.all([
        supabase.from("units").select("id, status, annual_rent"),
        supabase.from("payments").select("id, amount, status, due_date"),
        supabase.from("maintenance_requests").select("id, title, status, priority, created_at"),
        supabase.from("leases").select("id, end_date, status, annual_rent"),
        supabase.from("expenses").select("amount, expense_date"),
        supabase
          .from("meter_readings")
          .select(
            "id, unit_id, meter_type, reading, reading_date, units(unit_number, properties(name))",
          )
          .order("reading_date", { ascending: false })
          .limit(400),
      ]);
      return {
        units: units.data ?? [],
        payments: payments.data ?? [],
        maintenance: maintenance.data ?? [],
        leases: leases.data ?? [],
        expenses: expenses.data ?? [],
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </>
    );
  }

  // A sold unit has left the rental pool: it must not be counted as vacant, and it must not
  // silently deflate the occupancy rate as more units sell over time.
  const rentableUnits = data.units.filter((u) => u.status !== "sold");
  const total = rentableUnits.length;
  const occupied = rentableUnits.filter((u) => u.status === "occupied").length;
  const vacant = rentableUnits.filter((u) => u.status === "vacant").length;
  const occupancy = total ? Math.round((occupied / total) * 100) : 0;

  const collected = data.payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = data.payments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  // Nothing ever sets status = "overdue", so derive it from the due date.
  const overdue = data.payments.filter((p) => isOverdue(p));
  const expensesTotal = data.expenses.reduce((s, e) => s + Number(e.amount), 0);
  const openMaintenance = data.maintenance.filter((m) => m.status !== "done");
  const expiringSoon = data.leases
    .filter((l) => l.status === "active" && daysUntil(l.end_date) <= 90)
    .sort((a, b) => a.end_date.localeCompare(b.end_date));

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

  const electricityUsed = consumption
    .filter((c) => c.meterType !== "water")
    .reduce((s, c) => s + Math.max(c.used ?? 0, 0), 0);
  const waterUsed = consumption
    .filter((c) => c.meterType === "water")
    .reduce((s, c) => s + Math.max(c.used ?? 0, 0), 0);
  const lastReadingDate = data.readings[0]?.reading_date ?? null;
  const numberFmt = new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 });

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Building2}
          label="نسبة الإشغال"
          value={`${occupancy}%`}
          hint={`${occupied} مشغولة من ${total} وحدة`}
        />
        <StatCard
          icon={DoorOpen}
          label="الوحدات الشاغرة"
          value={String(vacant)}
          hint="جاهزة للتأجير"
        />
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
          hint={`${overdue.length} دفعة متأخرة`}
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
          value={String(openMaintenance.length)}
          hint="طلبات لم تُنجز"
        />
        <StatCard
          icon={Zap}
          label="استهلاك الكهرباء"
          value={numberFmt.format(electricityUsed)}
          hint={lastReadingDate ? `آخر قراءة ${shortDate(lastReadingDate)}` : "لا توجد قراءات بعد"}
        />
        <StatCard
          icon={Droplets}
          label="استهلاك المياه"
          value={numberFmt.format(waterUsed)}
          hint={lastReadingDate ? `آخر قراءة ${shortDate(lastReadingDate)}` : "لا توجد قراءات بعد"}
        />
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
              {occupied} مشغولة · {vacant} شاغرة
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
                  <Badge variant="outline">متبقٍ {daysUntil(l.end_date)} يوم</Badge>
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
            {data.maintenance.slice(0, 5).map((m) => (
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
            <CardTitle className="text-base">المتأخرات</CardTitle>
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
                  <span className="text-sm font-medium text-destructive">{sar(p.amount)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
