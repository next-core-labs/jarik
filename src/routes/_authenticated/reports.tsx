import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Download, BellRing } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { monthRange } from "@/lib/dates";
import { sar, shortDate } from "@/lib/format";
import { exportWorkbook } from "@/lib/export-excel";
import { downloadElementAsPdf } from "@/lib/pdf";
import { useOrgBranding } from "@/lib/use-org-branding";
import { listClientAccounts } from "@/lib/admin-users.functions";
import { splitVat } from "@/lib/zatca";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/reports")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "التقارير الشهرية — جارك" },
      {
        name: "description",
        content: "تقرير الشهر: التحصيلات والمصروفات والعمولات والإشغال وأداء الموظفين.",
      },
      { property: "og:title", content: "التقارير الشهرية — جارك" },
      { property: "og:description", content: "تقرير جاهز للتنزيل PDF وأداء فريق المكتب." },
    ],
  }),
  component: Reports,
});

function Reports() {
  const { org, logoDataUrl } = useOrgBranding();
  const reportRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  // Default range: the whole current month, both ends inclusive (Saudi time).
  const [from, setFrom] = useState(() => monthRange().start);
  const [to, setTo] = useState(() => monthRange().end);
  const now = new Date();
  const [vatYear, setVatYear] = useState(now.getFullYear());
  const [vatQuarter, setVatQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);

  // The range only filters what was already fetched, so it must not be part of the query key:
  // a new key on every date change refetched five tables and blanked the whole page (date
  // inputs included) while the user was still typing.
  const { data, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const [payments, expenses, deals, units, accounts, invoices] = await Promise.all([
        supabase
          .from("payments")
          .select("id, amount, status, paid_date, due_date, collected_by")
          .order("due_date"),
        supabase.from("expenses").select("id, amount, category, expense_date"),
        supabase.from("deals").select("id, stage, value, commission, assigned_to, created_at"),
        supabase.from("units").select("id, status, annual_rent"),
        listClientAccounts().catch(() => []),
        supabase.from("invoices").select("id, issue_date, vat_amount"),
      ]);
      if (payments.error) throw payments.error;
      return {
        payments: payments.data ?? [],
        expenses: expenses.data ?? [],
        deals: deals.data ?? [],
        units: units.data ?? [],
        accounts: (accounts ?? []) as { id: string; email: string; fullName: string }[],
        invoices: invoices.data ?? [],
      };
    },
  });

  const alertExpiring = useMutation({
    mutationFn: async () => {
      const { data: n, error } = await supabase.rpc("notify_expiring_leases", { _days: 60 });
      if (error) throw error;
      return Number(n ?? 0);
    },
    onSuccess: (n) =>
      toast.success(
        n > 0 ? `أُرسل تنبيه عن ${n} عقد ينتهي قريبًا` : "لا توجد عقود تنتهي خلال 60 يومًا",
      ),
    onError: () => toast.error("تعذّر إرسال التنبيهات — الصلاحية للموظفين"),
  });

  const download = async () => {
    if (!reportRef.current) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf(reportRef.current, `تقرير-${from.slice(0, 7)}.pdf`);
      toast.success("نزل تقرير الشهر PDF");
    } catch {
      toast.error("تعذّر إنشاء الملف");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="التقارير الشهرية" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const inMonth = (d: string | null) => !!d && d >= from && d <= to;
  const collected = data.payments
    .filter((p) => p.status === "paid" && inMonth(p.paid_date))
    .reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = data.payments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  const monthExpenses = data.expenses
    .filter((e) => inMonth(e.expense_date))
    .reduce((s, e) => s + Number(e.amount), 0);
  const commissions = data.deals
    .filter((d) => d.stage === "won")
    .reduce((s, d) => s + Number(d.commission), 0);
  // A sold unit has left the rental pool and must not dilute the occupancy rate.
  const rentableUnits = data.units.filter((u) => u.status !== "sold");
  const occupancy = rentableUnits.length
    ? Math.round(
        (rentableUnits.filter((u) => u.status === "occupied").length / rentableUnits.length) * 100,
      )
    : 0;

  const nameOf = (id: string | null) => {
    if (!id) return "غير مُسند";
    const a = data.accounts.find((x) => x.id === id);
    return a?.fullName || a?.email || "موظف";
  };
  const staffIds = [
    ...new Set([
      ...data.deals.map((d) => d.assigned_to),
      ...data.payments.map((p) => p.collected_by),
    ]),
  ].filter(Boolean) as string[];
  const performance = staffIds.map((id) => {
    const won = data.deals.filter((d) => d.assigned_to === id && d.stage === "won");
    const paid = data.payments.filter((p) => p.collected_by === id && p.status === "paid");
    return {
      id,
      name: nameOf(id),
      deals: data.deals.filter((d) => d.assigned_to === id).length,
      won: won.length,
      commission: won.reduce((s, d) => s + Number(d.commission), 0),
      collections: paid.length,
      collected: paid.reduce((s, p) => s + Number(p.amount), 0),
    };
  });

  const byCategory = Object.entries(
    data.expenses
      .filter((e) => inMonth(e.expense_date))
      .reduce<Record<string, number>>((acc, e) => {
        const key = e.category || "أخرى";
        acc[key] = (acc[key] ?? 0) + Number(e.amount);
        return acc;
      }, {}),
  );

  // إقرار ضريبة القيمة المضافة الفصلي (تقديري): المخرجات دقيقة من invoices.vat_amount (محسوبة
  // ومخزَّنة أصلًا بدقة الهللة)، والمدخلات تقديرية من expenses عبر splitVat — المصروفات مسجَّلة
  // كمبلغ واحد شامل الضريبة بلا فصل فعلي، فهذا أفضل تقريب متاح لا رقم مؤكد.
  const vatRate = Number(org.data?.vat_rate ?? 15);
  const quarterMonths = [0, 1, 2].map((i) => (vatQuarter - 1) * 3 + i + 1);
  const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const vatByMonth = quarterMonths.map((m) => {
    const key = monthKey(vatYear, m);
    const output = data.invoices
      .filter((i) => (i.issue_date ?? "").startsWith(key))
      .reduce((s, i) => s + Number(i.vat_amount ?? 0), 0);
    const input = data.expenses
      .filter((e) => (e.expense_date ?? "").startsWith(key))
      .reduce((s, e) => s + splitVat(Number(e.amount ?? 0), vatRate).vatAmount, 0);
    return { month: key, output, input, net: output - input };
  });
  const vatTotals = vatByMonth.reduce(
    (acc, r) => ({
      output: acc.output + r.output,
      input: acc.input + r.input,
      net: acc.net + r.net,
    }),
    { output: 0, input: 0, net: 0 },
  );

  const exportVatReport = () => {
    exportWorkbook(`إقرار-ضريبي-${vatYear}-ربع${vatQuarter}.xlsx`, [
      {
        name: "إقرار الربع",
        rows: [
          ...vatByMonth.map((r) => ({
            الشهر: r.month,
            "ضريبة المخرجات (دقيقة)": r.output,
            "ضريبة المدخلات (تقديرية)": Math.round(r.input * 100) / 100,
            "الصافي المقدَّر": Math.round(r.net * 100) / 100,
          })),
          {
            الشهر: "الإجمالي",
            "ضريبة المخرجات (دقيقة)": vatTotals.output,
            "ضريبة المدخلات (تقديرية)": Math.round(vatTotals.input * 100) / 100,
            "الصافي المقدَّر": Math.round(vatTotals.net * 100) / 100,
          },
          {
            الشهر: "تنويه",
            "ضريبة المخرجات (دقيقة)":
              "تقديري لأغراض المتابعة الداخلية فقط — راجع محاسبك قبل التقديم لهيئة الزكاة والضريبة والجمارك",
            "ضريبة المدخلات (تقديرية)": "",
            "الصافي المقدَّر": "",
          },
        ],
      },
    ]);
    toast.success("نزل ملف الإقرار — تقديري، راجعه مع محاسبك");
  };

  const exportExcel = () => {
    exportWorkbook(`تقرير-${from.slice(0, 7)}.xlsx`, [
      {
        name: "الملخص",
        rows: cards.map((c) => ({ البند: c.label, القيمة: c.value })),
      },
      {
        name: "الدفعات",
        rows: data.payments
          .filter((p) => inMonth(p.paid_date ?? p.due_date))
          .map((p) => ({
            المبلغ: Number(p.amount),
            الحالة: p.status,
            تاريخ_السداد: p.paid_date ?? "",
            الاستحقاق: p.due_date ?? "",
          })),
      },
      {
        name: "المصروفات",
        rows: data.expenses
          .filter((e) => inMonth(e.expense_date))
          .map((e) => ({
            التصنيف: e.category ?? "",
            التاريخ: e.expense_date ?? "",
            المبلغ: Number(e.amount),
          })),
      },
      {
        name: "أداء الموظفين",
        rows: performance.map((p) => ({
          الموظف: p.name,
          الصفقات: p.deals,
          الصفقات_المغلقة: p.won,
          العمولات: p.commission,
          التحصيلات: p.collections,
          مبلغ_التحصيل: p.collected,
        })),
      },
    ]);
    toast.success("نزل ملف الإكسل — جاهز للمحاسب");
  };

  const cards = [
    { label: "محصّل هذا الشهر", value: sar(collected) },
    { label: "مصروفات الشهر", value: sar(monthExpenses) },
    { label: "صافي الشهر", value: sar(collected - monthExpenses) },
    { label: "مستحقات غير محصّلة", value: sar(outstanding) },
    { label: "عمولات الصفقات المكتملة", value: sar(commissions) },
    { label: "نسبة الإشغال", value: `${occupancy}%` },
  ];

  return (
    <>
      <PageHeader
        title="التقارير الشهرية"
        subtitle="ملخّص الشهر جاهز للتنزيل، وأداء الفريق، وتنبيه العقود التي تنتهي قريبًا."
        action={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">من تاريخ</label>
              <Input
                type="date"
                dir="ltr"
                className="w-36"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-muted-foreground">إلى تاريخ</label>
              <Input
                type="date"
                dir="ltr"
                className="w-36"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={exportExcel}>
              <Download className="size-4" />
              تصدير Excel
            </Button>
            <Button
              variant="outline"
              disabled={alertExpiring.isPending}
              onClick={() => alertExpiring.mutate()}
            >
              <BellRing className="size-4" />
              تنبيه العقود المنتهية
            </Button>
            <Button disabled={downloading} onClick={download}>
              <Download className="size-4" />
              {downloading ? "جارٍ إنشاء الملف…" : "تنزيل تقرير الشهر PDF"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="shadow-deed">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="mt-2 font-display text-2xl font-bold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">أداء الموظفين</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {performance.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
            >
              <p className="font-medium">{p.name}</p>
              <p className="text-muted-foreground">
                صفقات {p.deals} · مغلقة <Badge variant="outline">{p.won}</Badge> · عمولات{" "}
                <span className="font-bold text-foreground">{sar(p.commission)}</span> · تحصيلات{" "}
                {p.collections} بمبلغ{" "}
                <span className="font-bold text-foreground">{sar(p.collected)}</span>
              </p>
            </div>
          ))}
          {performance.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد بيانات أداء بعد — الأداء يُحسب من الصفقات المُسندة للموظف والدفعات التي
              سجّلها.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">المصروفات حسب التصنيف</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {byCategory.map(([category, total]) => (
            <div
              key={category}
              className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm"
            >
              <p className="font-medium">{category}</p>
              <p className="font-bold text-foreground">{sar(total)}</p>
            </div>
          ))}
          {byCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد مصروفات في هذه الفترة.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">إقرار ضريبة القيمة المضافة الفصلي</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={String(vatQuarter)} onValueChange={(v) => setVatQuarter(Number(v))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">الربع الأول</SelectItem>
                  <SelectItem value="2">الربع الثاني</SelectItem>
                  <SelectItem value="3">الربع الثالث</SelectItem>
                  <SelectItem value="4">الربع الرابع</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                dir="ltr"
                className="w-24"
                value={vatYear}
                onChange={(e) => setVatYear(Number(e.target.value) || vatYear)}
              />
              <Button variant="outline" size="sm" onClick={exportVatReport}>
                <Download className="size-4" />
                تصدير الإقرار
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {vatByMonth.map((r) => (
            <div
              key={r.month}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">{r.month}</span>
              <span>مخرجات {sar(r.output)}</span>
              <span>مدخلات (تقديري) {sar(r.input)}</span>
              <span className="font-bold">صافي {sar(r.net)}</span>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brass/50 bg-muted/40 px-4 py-3 text-sm font-bold">
            <span>إجمالي الربع</span>
            <span>مخرجات {sar(vatTotals.output)}</span>
            <span>مدخلات (تقديري) {sar(vatTotals.input)}</span>
            <span>صافي {sar(vatTotals.net)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            تقديري لأغراض المتابعة الداخلية فقط — ضريبة المخرجات محسوبة بدقة من فواتيرك، أما
            المدخلات فتقدير من إجمالي المصروفات (لأنها غير مفصولة لمبلغ وضريبة). راجع محاسبك قبل
            التقديم لهيئة الزكاة والضريبة والجمارك.
          </p>
        </CardContent>
      </Card>

      <div
        ref={reportRef}
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
              <p className="text-lg font-bold">{org.data?.company_name ?? "المكتب العقاري"}</p>
              {org.data?.office_code ? (
                <p className="text-xs text-gray-500">شفرة المكتب: {org.data.office_code}</p>
              ) : null}
            </div>
          </div>
          <p className="text-sm text-gray-500">تقرير شهر {from.slice(0, 7)}</p>
        </div>
        <table className="mt-6 w-full text-sm">
          <tbody>
            {cards.map((c) => (
              <tr key={c.label} className="border-b">
                <td className="py-2 text-gray-600">{c.label}</td>
                <td className="py-2 text-left font-bold">{c.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-sm font-bold">المصروفات حسب التصنيف</p>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {byCategory.map(([category, total]) => (
              <tr key={category} className="border-b">
                <td className="py-2">{category}</td>
                <td className="py-2 text-left font-bold">{sar(total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-sm font-bold">أداء الموظفين</p>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {performance.map((p) => (
              <tr key={p.id} className="border-b">
                <td className="py-2">{p.name}</td>
                <td className="py-2 text-gray-600">صفقات مغلقة {p.won}</td>
                <td className="py-2 text-left font-bold">{sar(p.collected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-xs text-gray-500">
          صدر بتاريخ {shortDate(new Date().toISOString())} من منصة جارك.
        </p>
      </div>
    </>
  );
}
