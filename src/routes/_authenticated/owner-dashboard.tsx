import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  Building2,
  CalendarClock,
  Download,
  DoorOpen,
  HeartPulse,
  ReceiptText,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { OfficeIdentity } from "@/components/office-identity";
import { ReferralCard } from "@/components/referral-card";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { daysUntil, paymentStatusLabel, sar, shortDate, unitStatusLabel } from "@/lib/format";
import { portfolioHealthScore } from "@/lib/portfolio-health";
import { downloadElementAsPdf } from "@/lib/pdf";
import { useOrgBranding } from "@/lib/use-org-branding";
import { decideMaintenanceApproval } from "@/lib/portal-actions.functions";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/owner-dashboard")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "لوحة المالك — جارك" },
      {
        name: "description",
        content: "عقاراتك ووحداتك ونسبة إشغالها وعائدها، ومدفوعات مستأجريك وفواتيرك، في مكان واحد.",
      },
    ],
  }),
  component: OwnerDashboard,
});

const CHART_CONFIG: ChartConfig = {
  // --primary already holds a complete color value (hex), not decomposed HSL components — no
  // hsl(...) wrapper needed (that produced invalid CSS and silently fell back to a black bar).
  collected: { label: "محصّل", color: "var(--primary)" },
};

/** آخر 6 أشهر ميلادية، بترتيب زمني، بأسماء عربية مختصرة. */
function lastSixMonths(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("ar-SA", { month: "short" }),
    });
  }
  return out;
}

function OwnerDashboard() {
  const queryClient = useQueryClient();
  const { org: orgQuery, logoDataUrl } = useOrgBranding();
  const statementRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["owner-dashboard"],
    queryFn: async () => {
      const [properties, leases, payments, maintenance, market, roi] = await Promise.all([
        supabase
          .from("properties")
          .select(
            "id, name, city, district, units(id, unit_number, unit_type, status, annual_rent)",
          )
          .order("created_at"),
        // RLS scopes this to leases on the owner's own units (private.unit_owner) — no tenant PII
        // is selected here or anywhere else on this page: an owner cannot read the tenants table
        // directly (tenants_read requires is_staff or the tenant's own account), so the lease's
        // dates/status are the right level of detail here, not a name.
        supabase.from("leases").select("id, unit_id, end_date, status").eq("status", "active"),
        supabase
          .from("payments")
          .select(
            "id, amount, due_date, paid_date, status, leases(units(unit_number, properties(name, owner_id)))",
          )
          .order("due_date", { ascending: false }),
        supabase
          .from("maintenance_requests")
          .select("id, title, cost, approval_status, units(unit_number, properties(name))")
          .eq("approval_status", "pending"),
        supabase.rpc("market_stats"),
        supabase.rpc("owner_property_roi"),
      ]);
      return {
        properties: properties.data ?? [],
        leases: leases.data ?? [],
        payments: payments.data ?? [],
        maintenance: maintenance.data ?? [],
        market: (market.data ?? []) as {
          district: string | null;
          units_count: number;
          avg_rent: number;
          occupancy_pct: number;
        }[],
        roi: (roi.data ?? []) as {
          property_id: string;
          property_name: string;
          units_count: number;
          collected: number;
          expenses: number;
          net: number;
          roi_pct: number;
        }[],
      };
    },
  });

  const decide = useMutation({
    mutationFn: (payload: { requestId: string; approved: boolean }) =>
      decideMaintenanceApproval({ data: payload }),
    onSuccess: () => {
      toast.success("سُجّل قرارك ووصل للمكتب");
      queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] });
    },
    onError: () => toast.error("تعذّر تسجيل القرار"),
  });

  const downloadStatement = async () => {
    if (!statementRef.current) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf(statementRef.current, "كشف-حساب-المالك.pdf");
      toast.success("نزل كشف الحساب PDF");
    } catch {
      toast.error("تعذّر إنشاء الملف");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="لوحة المالك" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const allUnits = data.properties.flatMap((p) => p.units ?? []);
  const rentableUnits = allUnits.filter((u) => u.status !== "sold");
  const occupied = rentableUnits.filter((u) => u.status === "occupied").length;
  const occupancy = rentableUnits.length ? Math.round((occupied / rentableUnits.length) * 100) : 0;
  const dueTotal = data.payments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  const annualTotal = allUnits.reduce((s, u) => s + Number(u.annual_rent ?? 0), 0);
  const expensesTotal = data.roi.reduce((s, r) => s + Number(r.expenses ?? 0), 0);

  const months = lastSixMonths();
  const chartData = months.map((m) => ({
    month: m.label,
    collected: data.payments
      .filter((p) => p.status === "paid" && p.paid_date?.startsWith(m.key))
      .reduce((s, p) => s + Number(p.amount), 0),
  }));

  const leaseByUnit = new Map(data.leases.map((l) => [l.unit_id, l]));
  const propertyNameByUnit = new Map(
    data.properties.flatMap((p) => (p.units ?? []).map((u) => [u.id, p.name] as const)),
  );
  // Active leases ending within 60 days — the renewal window an owner should plan around.
  const expiringLeases = data.leases
    .filter((l) => {
      const d = daysUntil(l.end_date);
      return d >= 0 && d <= 60;
    })
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  const recentPayments = data.payments.slice(0, 8);

  const overdueCount = data.payments.filter((p) => p.status === "overdue").length;
  const health = portfolioHealthScore({
    occupancyPct: occupancy,
    overdueCount,
    pendingMaintenanceCount: data.maintenance.length,
    expiringLeasesCount: expiringLeases.length,
  });

  return (
    <>
      <PageHeader
        title="لوحة المالك"
        subtitle="عقاراتك ووحداتها، إشغالها وعائدها، والمستحقات من مستأجريك — بنظرة واحدة."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link to="/messages">تواصل مع المكتب</Link>
            </Button>
            {data.properties.length > 0 ? (
              <Button variant="outline" disabled={downloading} onClick={downloadStatement}>
                <Download className="size-4" />
                {downloading ? "جارٍ إنشاء الملف…" : "كشف حسابي PDF"}
              </Button>
            ) : null}
          </div>
        }
      />

      <OfficeIdentity />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Building2} label="عقاراتي" value={String(data.properties.length)} />
        <StatCard
          icon={DoorOpen}
          label="نسبة الإشغال"
          value={`${occupancy}%`}
          hint={`${occupied} من ${rentableUnits.length} وحدة مشغولة`}
        />
        <StatCard
          icon={Wallet}
          label="مستحقات غير محصّلة"
          value={sar(dueTotal)}
          tone={dueTotal > 0 ? "warn" : "default"}
        />
        <StatCard icon={TrendingUp} label="إجمالي الإيجارات السنوية" value={sar(annualTotal)} />
        <StatCard icon={ReceiptText} label="مصروفات عقاراتي" value={sar(expensesTotal)} />
      </div>

      <Card className="mb-6 shadow-deed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="size-4 text-brass" />
            صحة المحفظة
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span className="text-3xl font-bold">{health.score}</span>
            <Progress value={health.score} className="h-2 flex-1" />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{health.summary}</p>
        </CardContent>
      </Card>

      {expiringLeases.length > 0 ? (
        <Card className="mb-6 border-brass/50 shadow-deed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-brass" />
              عقود تنتهي خلال 60 يومًا
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {expiringLeases.map((l) => (
              <div key={l.id} className="rounded-md border border-border bg-background p-4">
                <p className="font-medium">
                  {propertyNameByUnit.get(l.unit_id) ?? "—"} ·{" "}
                  {allUnits.find((u) => u.id === l.unit_id)?.unit_number ?? "—"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  ينتهي {shortDate(l.end_date)} — بعد {daysUntil(l.end_date)} يوم
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {data.maintenance.length > 0 ? (
        <Card id="approvals" className="mb-6 scroll-mt-4 border-brass/50 shadow-deed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4 text-brass" />
              صيانة تنتظر موافقتك
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.maintenance.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-4"
              >
                <div>
                  <p className="font-medium">{m.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {m.units?.properties?.name ?? ""} · وحدة {m.units?.unit_number ?? "—"} · التكلفة{" "}
                    <span className="font-bold text-foreground">{sar(m.cost)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ requestId: m.id, approved: true })}
                  >
                    موافقة
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ requestId: m.id, approved: false })}
                  >
                    رفض
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div id="finance" className="scroll-mt-4">
        <Card className="mb-6 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">التحصيل خلال آخر 6 أشهر</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={CHART_CONFIG} className="h-64 w-full">
              <BarChart data={chartData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="collected" fill="var(--color-collected)" radius={0} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div id="reports" className="mb-6 grid scroll-mt-4 gap-6 lg:grid-cols-2">
        {data.market.length > 0 ? (
          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-base">تقرير سوق الأحياء</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.market.map((m) => (
                <div
                  key={m.district ?? "—"}
                  className="rounded-md border border-border bg-background px-4 py-3 text-sm"
                >
                  <p className="font-medium">{m.district ?? "بدون حي محدد"}</p>
                  <p className="mt-1 text-muted-foreground">
                    متوسط الإيجار{" "}
                    <span className="font-bold text-foreground">{sar(m.avg_rent)}</span> · الإشغال{" "}
                    <span className="font-bold text-foreground">
                      {Math.round(m.occupancy_pct)}%
                    </span>{" "}
                    · {m.units_count} وحدة
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {data.roi.length > 0 ? (
          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-base">مقارنة عائد عقاراتي</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.roi.map((r) => (
                <div
                  key={r.property_id}
                  className="rounded-md border border-border bg-background px-4 py-3 text-sm"
                >
                  <p className="font-medium">
                    {r.property_name} · {r.units_count} وحدة
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    الصافي <span className="font-bold text-foreground">{sar(r.net)}</span> · العائد{" "}
                    <span className="font-bold text-foreground">{Number(r.roi_pct)}%</span>
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="mb-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">آخر المدفوعات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentPayments.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">
                {p.leases?.units?.properties?.name ?? ""} · وحدة{" "}
                {p.leases?.units?.unit_number ?? "—"}
              </span>
              <span>{shortDate(p.due_date)}</span>
              <span className="font-medium">{sar(p.amount)}</span>
              <Badge variant={p.status === "paid" ? "secondary" : "outline"}>
                {paymentStatusLabel[p.status] ?? p.status}
              </Badge>
            </div>
          ))}
          {recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد دفعات بعد.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card id="units" className="mb-6 scroll-mt-4 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">وحداتي</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allUnits.map((u) => {
            const lease = leaseByUnit.get(u.id);
            return (
              <div key={u.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">
                    وحدة {u.unit_number} · {u.unit_type}
                  </p>
                  <span className="bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {unitStatusLabel[u.status] ?? u.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{sar(u.annual_rent)} سنويًا</p>
                {/* Lease dates only — an owner cannot read the tenants table directly (RLS), so no
                    tenant name is shown here, only what the lease itself reveals. */}
                {lease ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    العقد الحالي حتى {shortDate(lease.end_date)}
                  </p>
                ) : null}
              </div>
            );
          })}
          {allUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground sm:col-span-3">
              لا توجد وحدات مسجّلة باسمك بعد.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <ReferralCard />

      {data.properties.length > 0 ? (
        <div
          ref={statementRef}
          dir="rtl"
          className="pointer-events-none fixed -left-[10000px] top-0 w-[700px] bg-white p-8 text-black"
          aria-hidden="true"
        >
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-3">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="" className="size-12 rounded object-contain" />
              ) : null}
              <div>
                <p className="text-lg font-bold">
                  {orgQuery.data?.company_name ?? "المكتب العقاري"}
                </p>
                {orgQuery.data?.fal_license_no ? (
                  <p className="text-xs text-gray-500">ترخيص فال: {orgQuery.data.fal_license_no}</p>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-gray-500">
              تاريخ الإصدار: {new Date().toLocaleDateString("ar-SA")}
            </p>
          </div>
          <h2 className="mt-6 text-xl font-bold">كشف حساب المالك</h2>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-right text-gray-600">
                <th className="py-2">الوحدة</th>
                <th className="py-2">النوع</th>
                <th className="py-2">العقار</th>
                <th className="py-2">الحالة</th>
                <th className="py-2">الإيجار السنوي</th>
              </tr>
            </thead>
            <tbody>
              {allUnits.map((u) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2">{u.unit_number}</td>
                  <td className="py-2">{u.unit_type}</td>
                  <td className="py-2">
                    {data.properties.find((p) => (p.units ?? []).some((x) => x.id === u.id))
                      ?.name ?? "—"}
                  </td>
                  <td className="py-2">{unitStatusLabel[u.status] ?? u.status}</td>
                  <td className="py-2">{sar(u.annual_rent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-between border-t pt-3 text-sm font-bold">
            <span>إجمالي الإيجارات السنوية</span>
            <span>{sar(annualTotal)}</span>
          </div>
          <p className="mt-2 text-sm">المستحقات غير المحصّلة: {sar(dueTotal)}</p>
          <p className="mt-6 text-xs text-gray-400">صادر تلقائيًا من منصة جارك</p>
        </div>
      ) : null}
    </>
  );
}
