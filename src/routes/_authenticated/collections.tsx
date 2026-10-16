import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, CalendarClock, Download } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { remindPayments } from "@/lib/whatsapp-out.functions";
import { runSmartReminders } from "@/lib/office-tools.functions";
import { exportWorkbook } from "@/lib/export-excel";

import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDays, effectiveStatus, todayRiyadh } from "@/lib/dates";
import { sar, shortDate, paymentStatusLabel } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/collections")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "التحصيل والمصروفات — جارك" },
      { name: "description", content: "الدفعات والمتأخرات والمصروفات وتسجيل السداد." },
      { property: "og:title", content: "التحصيل والمصروفات — جارك" },
      { property: "og:description", content: "متابعة الدفعات والمتأخرات والمصروفات." },
    ],
  }),
  component: Collections,
});

function Collections() {
  const queryClient = useQueryClient();
  const sendReminders = useServerFn(remindPayments);
  const runSmart = useServerFn(runSmartReminders);

  const smartRemind = useMutation({
    mutationFn: () => runSmart(),
    onSuccess: (res) => {
      toast.success(
        res.count > 0
          ? `أُرسل ${res.count} تذكير ذكي للمستأجرين قبل استحقاق دفعاتهم`
          : "لا توجد دفعات على موعد التذكير اليوم (قبل 7 أو 3 أيام أو يوم الاستحقاق)",
      );
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تشغيل التذكير الذكي"),
  });

  const exportExcel = () => {
    if (!data) return;
    exportWorkbook("التحصيل-والمصروفات.xlsx", [
      {
        name: "الدفعات",
        rows: data.payments.map((p) => ({
          المستأجر: p.leases?.tenants?.full_name ?? "",
          العقار: p.leases?.units?.properties?.name ?? "",
          الوحدة: p.leases?.units?.unit_number ?? "",
          الاستحقاق: p.due_date ?? "",
          تاريخ_السداد: p.paid_date ?? "",
          المبلغ: Number(p.amount),
          الحالة: paymentStatusLabel[p.status] ?? p.status,
          مرجع_التحويل: p.transfer_reference ?? "",
        })),
      },
      {
        name: "المصروفات",
        rows: data.expenses.map((e) => ({
          البيان: e.title ?? "",
          التصنيف: e.category ?? "",
          العقار: e.properties?.name ?? "",
          التاريخ: e.expense_date ?? "",
          المبلغ: Number(e.amount),
        })),
      },
    ]);
    toast.success("نزل ملف الإكسل — جاهز للمحاسب");
  };

  const { data, isLoading } = useQuery({
    queryKey: ["collections"],
    queryFn: async () => {
      const [payments, expenses] = await Promise.all([
        supabase
          .from("payments")
          .select(
            "id, amount, due_date, paid_date, status, method, last_reminded_at, transfer_reference, transfer_submitted_at, leases(tenants(full_name, user_id, phone), units(unit_number, properties(name)))",
          )
          .order("due_date"),
        supabase
          .from("expenses")
          .select("id, title, category, amount, expense_date, properties(name)")
          .order("expense_date", { ascending: false }),
      ]);
      if (payments.error) throw payments.error;
      return { payments: payments.data ?? [], expenses: expenses.data ?? [] };
    },
  });

  const remind = useMutation({
    mutationFn: async (ids: string[]) => {
      const targets = (data?.payments ?? [])
        .filter((p) => ids.includes(p.id) && p.status !== "paid")
        .map((p) => p.id);
      if (targets.length === 0) return { notified: 0, whatsapped: 0, total: 0 };
      return sendReminders({ data: { paymentIds: targets } });
    },
    onSuccess: (res) => {
      toast.success(
        res.total > 0
          ? `أُرسلت ${res.notified} تذكيرات داخل المنصة${res.whatsapped > 0 ? ` و${res.whatsapped} رسالة واتساب` : ""}`
          : "لا توجد دفعات تحتاج تذكيرًا",
      );
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال التذكير"),
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("payments")
        .update({
          status: "paid",
          paid_date: todayRiyadh(),
          collected_by: auth.user?.id ?? null,
        })
        .eq("id", id)
        // Re-marking an already-paid payment would overwrite who collected it and when.
        .neq("status", "paid");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل السداد");
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("تعذّر تسجيل السداد — الصلاحية للموظفين فقط"),
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="التحصيل والمصروفات" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const collected = data.payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = data.payments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  const expensesTotal = data.expenses.reduce((s, e) => s + Number(e.amount), 0);

  const today = todayRiyadh();
  const in7Days = addDays(today, 7);
  const overdueList = data.payments
    .filter((p) => p.status !== "paid" && p.due_date < today)
    .sort((a, b) => Number(b.amount) - Number(a.amount));
  const dueSoonList = data.payments.filter(
    (p) => p.status !== "paid" && p.due_date >= today && p.due_date <= in7Days,
  );
  const reminderTargets = [...overdueList, ...dueSoonList].map((p) => p.id);

  type Payment = (typeof data.payments)[number];
  const paymentBadge = (p: Payment) => (
    <Badge
      variant={
        p.status === "paid"
          ? "default"
          : effectiveStatus(p) === "overdue"
            ? "destructive"
            : "outline"
      }
    >
      {paymentStatusLabel[effectiveStatus(p)] ?? p.status}
    </Badge>
  );
  const transferNote = (p: Payment) =>
    p.transfer_reference && p.status !== "paid" ? (
      <span className="mt-1 block text-xs text-brass">
        المستأجر أبلغ عن تحويل: {p.transfer_reference}
      </span>
    ) : null;
  /** `full` stretches the button across a phone card. */
  const paymentAction = (p: Payment, full: boolean) =>
    p.status !== "paid" ? (
      <Button
        size="sm"
        variant="outline"
        className={full ? "w-full" : undefined}
        disabled={markPaid.isPending}
        onClick={() => markPaid.mutate(p.id)}
      >
        تسجيل السداد
      </Button>
    ) : (
      <span className="text-xs text-muted-foreground">سُددت {shortDate(p.paid_date)}</span>
    );

  return (
    <>
      <PageHeader
        title="التحصيل والمصروفات"
        subtitle="الدفعات والمتأخرات والمصروفات — والنظام يذكّر المستأجرين نيابةً عنك."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportExcel}>
              <Download className="size-4" />
              تصدير Excel
            </Button>
            <Button
              variant="outline"
              disabled={smartRemind.isPending}
              onClick={() => smartRemind.mutate()}
            >
              <CalendarClock className="size-4" />
              تذكير ذكي قبل الاستحقاق
            </Button>
            <Button
              disabled={reminderTargets.length === 0 || remind.isPending}
              onClick={() => remind.mutate(reminderTargets)}
            >
              <BellRing className="size-4" />
              تذكيرات اليوم ({reminderTargets.length})
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "المحصّل", value: sar(collected) },
          { label: "المستحق", value: sar(outstanding) },
          { label: "المصروفات", value: sar(expensesTotal) },
        ].map((s) => (
          <Card key={s.label} className="shadow-deed">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-2 font-display text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {overdueList.length > 0 ? (
        <Card className="mt-6 border-destructive/40 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              المتأخرات — مرتبة من الأعلى مبلغًا ({overdueList.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overdueList.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{p.leases?.tenants?.full_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.leases?.units?.properties?.name} · وحدة {p.leases?.units?.unit_number} ·
                    استحقت {shortDate(p.due_date)}
                    {p.last_reminded_at
                      ? ` · آخر تذكير ${shortDate(p.last_reminded_at)}`
                      : " · لم يُذكَّر بعد"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-destructive">{sar(p.amount)}</span>
                  {p.leases?.tenants?.phone ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={`tel:${p.leases.tenants.phone}`}>اتصال</a>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remind.isPending || !p.leases?.tenants?.user_id}
                    title={
                      p.leases?.tenants?.user_id
                        ? "إرسال تذكير داخل المنصة"
                        : "لا يوجد حساب مرتبط بهذا المستأجر"
                    }
                    onClick={() => remind.mutate([p.id])}
                  >
                    <BellRing className="size-4" />
                    تذكير
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">الدفعات</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Phones: one card per payment instead of a six-column table. */}
          <ul className="divide-y divide-border md:hidden">
            {data.payments.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-4 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{p.leases?.tenants?.full_name ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.leases?.units?.properties?.name} · {p.leases?.units?.unit_number} · تستحق{" "}
                      {shortDate(p.due_date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <p className="font-bold tabular-nums">{sar(p.amount)}</p>
                    {paymentBadge(p)}
                  </div>
                </div>
                {transferNote(p)}
                {paymentAction(p, true)}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المستأجر</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead>الاستحقاق</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.leases?.tenants?.full_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      {p.leases?.units?.properties?.name} · {p.leases?.units?.unit_number}
                    </TableCell>
                    <TableCell>{shortDate(p.due_date)}</TableCell>
                    <TableCell>
                      {sar(p.amount)}
                      {transferNote(p)}
                    </TableCell>
                    <TableCell>{paymentBadge(p)}</TableCell>
                    <TableCell>{paymentAction(p, false)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">المصروفات</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border md:hidden">
            {data.expenses.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {[e.category, e.properties?.name, shortDate(e.expense_date)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <p className="shrink-0 font-bold tabular-nums">{sar(e.amount)}</p>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>البيان</TableHead>
                  <TableHead>التصنيف</TableHead>
                  <TableHead>العقار</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المبلغ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.title}</TableCell>
                    <TableCell>{e.category}</TableCell>
                    <TableCell>{e.properties?.name ?? "—"}</TableCell>
                    <TableCell>{shortDate(e.expense_date)}</TableCell>
                    <TableCell>{sar(e.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
