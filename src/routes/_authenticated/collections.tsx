import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";
import { BellRing, CalendarClock, Download, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { remindPayments } from "@/lib/whatsapp-out.functions";
import { runSmartReminders } from "@/lib/office-tools.functions";
import { exportWorkbook } from "@/lib/export-excel";

import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDays, effectiveStatus, monthRange, todayRiyadh } from "@/lib/dates";
import { arNum, sar, shortDate, paymentStatusLabel } from "@/lib/format";

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

const PAYMENT_METHODS = ["تحويل بنكي", "مدى", "نقدًا", "شيك"];

type StatusFilter = "all" | "overdue" | "due" | "paid";
type PeriodFilter = "all" | "this-month" | "last-month" | "next-month" | "this-year";

/** Due-date bounds for a period filter (inclusive, YYYY-MM-DD), or null for no bound. */
function periodBounds(period: PeriodFilter): { start: string; end: string } | null {
  if (period === "this-month") return monthRange(0);
  if (period === "last-month") return monthRange(-1);
  if (period === "next-month") return monthRange(1);
  if (period === "this-year") {
    const year = todayRiyadh().slice(0, 4);
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  return null;
}

function Collections() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [search, setSearch] = useState("");
  // The payment waiting for the "record payment" confirmation, with the form for it.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [method, setMethod] = useState(PAYMENT_METHODS[0]!);
  const [paidDate, setPaidDate] = useState(todayRiyadh());
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
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تشغيل التذكير الذكي")),
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
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال التذكير")),
  });

  const markPaid = useMutation({
    mutationFn: async (v: { id: string; method: string; paidDate: string }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { data: updated, error } = await supabase
        .from("payments")
        .update({
          status: "paid",
          paid_date: v.paidDate,
          method: v.method,
          collected_by: auth.user?.id ?? null,
        })
        .eq("id", v.id)
        // Re-marking an already-paid payment would overwrite who collected it and when.
        .neq("status", "paid")
        .select("id");
      if (error) throw error;
      if (!updated?.length) throw new Error("سبق تسجيل سداد هذه الدفعة");
    },
    onSuccess: () => {
      setConfirmId(null);
      toast.success("تم تسجيل السداد");
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(userErrorMessage(e, "تعذّر تسجيل السداد")),
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

  const bounds = periodBounds(period);
  const query = search.trim().toLowerCase();
  const visiblePayments = data.payments.filter((p) => {
    const status = effectiveStatus(p, today);
    if (statusFilter === "paid" && status !== "paid") return false;
    if (statusFilter === "overdue" && status !== "overdue") return false;
    if (statusFilter === "due" && (status === "paid" || status === "overdue")) return false;
    if (bounds && (p.due_date < bounds.start || p.due_date > bounds.end)) return false;
    if (query) {
      const haystack = [
        p.leases?.tenants?.full_name,
        p.leases?.units?.unit_number,
        p.leases?.units?.properties?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  const filtered = statusFilter !== "all" || period !== "all" || query !== "";

  const confirming = data.payments.find((p) => p.id === confirmId) ?? null;
  const paidDateError = !paidDate
    ? "اختر تاريخ السداد"
    : paidDate > today
      ? "تاريخ السداد لا يكون في المستقبل"
      : null;

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
        onClick={() => {
          setMethod(p.transfer_reference ? "تحويل بنكي" : PAYMENT_METHODS[0]!);
          setPaidDate(todayRiyadh());
          setConfirmId(p.id);
        }}
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
              تذكيرات اليوم ({arNum(reminderTargets.length)})
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
              المتأخرات — مرتبة من الأعلى مبلغًا ({arNum(overdueList.length)})
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
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">
            الدفعات
            {filtered ? (
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                ({arNum(visiblePayments.length)} من {arNum(data.payments.length)})
              </span>
            ) : null}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث باسم المستأجر أو الوحدة أو العقار"
                aria-label="بحث في الدفعات"
                className="ps-9"
              />
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="flex-1 sm:w-36" aria-label="الحالة">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  <SelectItem value="overdue">متأخرة</SelectItem>
                  <SelectItem value="due">مستحقة</SelectItem>
                  <SelectItem value="paid">مدفوعة</SelectItem>
                </SelectContent>
              </Select>
              <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
                <SelectTrigger className="flex-1 sm:w-40" aria-label="فترة الاستحقاق">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفترات</SelectItem>
                  <SelectItem value="this-month">تستحق هذا الشهر</SelectItem>
                  <SelectItem value="last-month">الشهر الماضي</SelectItem>
                  <SelectItem value="next-month">الشهر القادم</SelectItem>
                  <SelectItem value="this-year">هذه السنة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {visiblePayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filtered ? "لا توجد دفعات تطابق البحث أو التصفية." : "لا توجد دفعات بعد."}
            </p>
          ) : null}
          {/* Phones: one card per payment instead of a six-column table. */}
          <ul className="divide-y divide-border md:hidden">
            {visiblePayments.map((p) => (
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
                {visiblePayments.map((p) => (
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

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تأكيد تسجيل السداد</DialogTitle>
            <DialogDescription>
              ستُسجَّل الدفعة كاملة كمدفوعة. راجع البيانات قبل التأكيد.
            </DialogDescription>
          </DialogHeader>
          {confirming ? (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/50 p-3">
                <dt className="text-muted-foreground">المستأجر</dt>
                <dd className="font-medium">{confirming.leases?.tenants?.full_name ?? "—"}</dd>
                <dt className="text-muted-foreground">الوحدة</dt>
                <dd>
                  {confirming.leases?.units?.properties?.name} ·{" "}
                  {confirming.leases?.units?.unit_number ?? "—"}
                </dd>
                <dt className="text-muted-foreground">تاريخ الاستحقاق</dt>
                <dd>{shortDate(confirming.due_date)}</dd>
                <dt className="text-muted-foreground">المبلغ</dt>
                <dd className="font-bold">{sar(confirming.amount)}</dd>
              </dl>
              {confirming.transfer_reference ? (
                <p className="text-xs text-brass">
                  المستأجر أبلغ عن تحويل: {confirming.transfer_reference}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="pay-method">طريقة السداد</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger id="pay-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pay-date">تاريخ السداد</Label>
                  <Input
                    id="pay-date"
                    type="date"
                    dir="ltr"
                    max={today}
                    value={paidDate}
                    onChange={(e) => setPaidDate(e.target.value)}
                    aria-invalid={!!paidDateError}
                  />
                  {paidDateError ? (
                    <p className="text-xs text-destructive">{paidDateError}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>
              إلغاء
            </Button>
            <Button
              disabled={!confirming || !!paidDateError || markPaid.isPending}
              onClick={() => confirming && markPaid.mutate({ id: confirming.id, method, paidDate })}
            >
              {markPaid.isPending ? "جارٍ التسجيل…" : "تأكيد السداد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
