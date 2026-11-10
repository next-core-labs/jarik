import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";
import { BellRing, CalendarClock, Download, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { remindPayments } from "@/lib/whatsapp-out.functions";
import { runSmartReminders } from "@/lib/office-tools.functions";
import { exportWorkbook } from "@/lib/export-excel";
import { parseAmount } from "@/lib/public-form";

import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { effectiveStatus, monthRange, todayRiyadh } from "@/lib/dates";
import { arCount, arNum, sar, shortDate, paymentStatusLabel } from "@/lib/format";

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
const PAGE_SIZE = 50;
/** remindPayments accepts up to 100 payments per call. */
const REMIND_BATCH = 100;

type StatusFilter = "all" | "overdue" | "due" | "paid";
type PeriodFilter = "all" | "this-month" | "last-month" | "next-month" | "this-year";
type OfficePayment = Database["public"]["Functions"]["office_payments"]["Returns"][number];
type FinanceSummary = {
  collected: number;
  outstanding: number;
  overdue_count: number;
  remind_count: number;
  payments_count: number;
  expenses_total: number;
};

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

/** One page of the office's payments, filtered and ordered in the database. */
async function fetchPayments(args: {
  status: string;
  from?: string | null;
  to?: string | null;
  search?: string | null;
  order?: "due" | "amount";
  limit: number;
  offset: number;
}) {
  const { data, error } = await supabase.rpc("office_payments", {
    _status: args.status,
    ...(args.from ? { _from: args.from } : {}),
    ...(args.to ? { _to: args.to } : {}),
    ...(args.search ? { _search: args.search } : {}),
    _order: args.order ?? "due",
    _limit: args.limit,
    _offset: args.offset,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}

/** What is still owed on an installment (partial payments reduce it). */
const remainingOf = (p: { amount: number; amount_paid: number }) =>
  Math.round((Number(p.amount) - Number(p.amount_paid)) * 100) / 100;

function Collections() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expensePage, setExpensePage] = useState(0);
  // The payment waiting for the "record payment" confirmation, with the form for it.
  const [confirming, setConfirming] = useState<OfficePayment | null>(null);
  const [method, setMethod] = useState(PAYMENT_METHODS[0]!);
  const [paidDate, setPaidDate] = useState(todayRiyadh());
  const [amountText, setAmountText] = useState("");
  const [rejecting, setRejecting] = useState<OfficePayment | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [exporting, setExporting] = useState(false);
  const sendReminders = useServerFn(remindPayments);
  const runSmart = useServerFn(runSmartReminders);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);
  // A new filter starts from the first page.
  useEffect(() => setPage(0), [statusFilter, period, debouncedSearch]);

  const smartRemind = useMutation({
    mutationFn: () => runSmart(),
    onSuccess: (res) => {
      toast.success(
        res.count > 0
          ? `أُرسل ${arCount(res.count, { one: "تذكير ذكي واحد", two: "تذكيران ذكيان", few: "تذكيرات ذكية", many: "تذكيرًا ذكيًا" })} للمستأجرين قبل استحقاق دفعاتهم`
          : "لا توجد دفعات على موعد التذكير اليوم (قبل ٧ أو ٣ أيام أو يوم الاستحقاق)",
      );
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تشغيل التذكير الذكي")),
  });

  const summary = useQuery({
    queryKey: ["collections", "summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("office_finance_summary");
      if (error) throw error;
      return data as unknown as FinanceSummary;
    },
  });

  const bounds = periodBounds(period);
  const statusArg = statusFilter === "all" ? "all" : statusFilter;
  const filtered = statusFilter !== "all" || period !== "all" || debouncedSearch !== "";
  const list = useQuery({
    queryKey: ["collections", "payments", statusArg, period, debouncedSearch, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchPayments({
        status: statusArg,
        from: bounds?.start ?? null,
        to: bounds?.end ?? null,
        search: debouncedSearch || null,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  // Largest overdue balances first; the full list is one filter away.
  // A page past the end (rows paid or filtered away since it was opened) has no total_count to page
  // by, so go back to the first page instead of leaving the user on an empty page with no pager.
  useEffect(() => {
    if (page > 0 && list.data && list.data.rows.length === 0) setPage(0);
  }, [page, list.data]);

  const overdue = useQuery({
    queryKey: ["collections", "overdue"],
    queryFn: () => fetchPayments({ status: "overdue", order: "amount", limit: 20, offset: 0 }),
  });

  const expenses = useQuery({
    queryKey: ["collections", "expenses", expensePage],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("expenses")
        .select("id, title, category, amount, expense_date, properties(name)", { count: "exact" })
        .order("expense_date", { ascending: false })
        .range(expensePage * PAGE_SIZE, expensePage * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
    },
  });

  const exportExcel = async () => {
    setExporting(true);
    try {
      // Every row, a thousand at a time: the export is the accountant's full ledger.
      const payments: OfficePayment[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { rows } = await fetchPayments({ status: "all", limit: 1000, offset });
        payments.push(...rows);
        if (rows.length < 1000) break;
      }
      const expenseRows: {
        title: string | null;
        category: string | null;
        amount: number;
        expense_date: string | null;
        properties: { name: string } | null;
      }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("expenses")
          .select("title, category, amount, expense_date, properties(name)")
          .order("expense_date", { ascending: false })
          .range(from, from + 999);
        if (error) throw error;
        expenseRows.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
      }
      exportWorkbook("التحصيل-والمصروفات.xlsx", [
        {
          name: "الدفعات",
          rows: payments.map((p) => ({
            المستأجر: p.tenant_name ?? "",
            العقار: p.property_name ?? "",
            الوحدة: p.unit_number ?? "",
            الاستحقاق: p.due_date ?? "",
            تاريخ_السداد: p.paid_date ?? "",
            المبلغ: Number(p.amount),
            المسدد: Number(p.amount_paid),
            الحالة: paymentStatusLabel[p.status] ?? p.status,
            مرجع_التحويل: p.transfer_reference ?? "",
          })),
        },
        {
          name: "المصروفات",
          rows: expenseRows.map((e) => ({
            البيان: e.title ?? "",
            التصنيف: e.category ?? "",
            العقار: e.properties?.name ?? "",
            التاريخ: e.expense_date ?? "",
            المبلغ: Number(e.amount),
          })),
        },
      ]);
      toast.success("نزل ملف الإكسل — جاهز للمحاسب");
    } catch (e) {
      toast.error(userErrorMessage(e, "تعذّر تجهيز ملف الإكسل"));
    } finally {
      setExporting(false);
    }
  };

  const remind = useMutation({
    mutationFn: async (ids: string[] | null) => {
      // null = today's reminders: overdue and due within 7 days, oldest first.
      const targets =
        ids ??
        (await fetchPayments({ status: "remind", limit: REMIND_BATCH, offset: 0 })).rows.map(
          (p) => p.id,
        );
      if (targets.length === 0) return { notified: 0, whatsapped: 0, total: 0 };
      return sendReminders({ data: { paymentIds: targets } });
    },
    onSuccess: (res) => {
      toast.success(
        res.total > 0
          ? `أُرسل ${arCount(res.notified, { one: "تذكير واحد", two: "تذكيران", few: "تذكيرات", many: "تذكيرًا" })} داخل المنصة${res.whatsapped > 0 ? ` و${arCount(res.whatsapped, { one: "رسالة واتساب واحدة", two: "رسالتا واتساب", few: "رسائل واتساب", many: "رسالة واتساب" })}` : ""}`
          : "لا توجد دفعات تحتاج تذكيرًا",
      );
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال التذكير")),
  });

  const markPaid = useMutation({
    mutationFn: async (v: { id: string; amount: number; method: string; paidDate: string }) => {
      const { data, error } = await supabase.rpc("record_payment", {
        _payment_id: v.id,
        _amount: v.amount,
        _paid_date: v.paidDate,
        _method: v.method,
      });
      if (error) throw error;
      return data as unknown as { status: string; remaining: number };
    },
    onSuccess: (res) => {
      setConfirming(null);
      toast.success(
        res.status === "paid"
          ? "تم تسجيل السداد"
          : `سُجّلت دفعة جزئية — المتبقي ${sar(res.remaining)}`,
      );
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(userErrorMessage(e, "تعذّر تسجيل السداد")),
  });

  const rejectTransfer = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("reject_transfer_notice", {
        _payment_id: v.id,
        _reason: v.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setRejecting(null);
      toast.success("رُفض الإبلاغ وأُبلغ المستأجر بالسبب");
      queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (e) => toast.error(userErrorMessage(e, "تعذّر رفض الإبلاغ")),
  });

  if (summary.isLoading || list.isLoading || !summary.data || !list.data) {
    return (
      <>
        <PageHeader title="التحصيل والمصروفات" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const today = todayRiyadh();
  const totals = summary.data;
  const overdueList = overdue.data?.rows ?? [];
  const overdueTotal = overdue.data?.total ?? 0;
  const visiblePayments = list.data.rows;
  const matching = list.data.total;
  const pages = Math.max(1, Math.ceil(matching / PAGE_SIZE));

  const confirmRemaining = confirming ? remainingOf(confirming) : 0;
  const amountValue = parseAmount(amountText);
  const amountError =
    amountValue === undefined
      ? "أدخل المبلغ المستلم"
      : amountValue === null || amountValue <= 0
        ? "أدخل مبلغًا صحيحًا بالريال"
        : Math.round(amountValue * 100) !== amountValue * 100
          ? "المبلغ بحد أقصى منزلتين عشريتين"
          : amountValue > confirmRemaining
            ? `المبلغ أكبر من المتبقي (${sar(confirmRemaining)})`
            : null;
  const paidDateError = !paidDate
    ? "اختر تاريخ السداد"
    : paidDate > today
      ? "تاريخ السداد لا يكون في المستقبل"
      : null;
  const rejectError = rejectReason.trim().length < 3 ? "اكتب سبب الرفض ليصل للمستأجر" : null;

  type Payment = OfficePayment;
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
  const amountCell = (p: Payment) => (
    <>
      {sar(p.amount)}
      {p.status !== "paid" && Number(p.amount_paid) > 0 ? (
        <span className="block text-xs text-muted-foreground">
          سُدد {sar(p.amount_paid)} · المتبقي {sar(remainingOf(p))}
        </span>
      ) : null}
    </>
  );
  const transferNote = (p: Payment) =>
    p.transfer_reference && p.status !== "paid" ? (
      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brass">
        المستأجر أبلغ عن تحويل: {p.transfer_reference}
        <Button
          size="sm"
          variant="link"
          className="h-auto px-0 text-xs"
          onClick={() => {
            setRejectReason("");
            setRejecting(p);
          }}
        >
          رفض الإبلاغ
        </Button>
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
          setAmountText(String(remainingOf(p)));
          setConfirming(p);
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
            <Button variant="outline" disabled={exporting} onClick={exportExcel}>
              <Download className="size-4" />
              {exporting ? "جارٍ التجهيز…" : "تصدير Excel"}
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
              disabled={totals.remind_count === 0 || remind.isPending}
              onClick={() => remind.mutate(null)}
              title={
                totals.remind_count > REMIND_BATCH
                  ? `يُرسل لأقدم ${arNum(REMIND_BATCH)} دفعة في كل مرة`
                  : undefined
              }
            >
              <BellRing className="size-4" />
              تذكيرات اليوم ({arNum(totals.remind_count)})
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "المحصّل", value: sar(totals.collected) },
          { label: "المستحق", value: sar(totals.outstanding) },
          { label: "المصروفات", value: sar(totals.expenses_total) },
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
              المتأخرات — مرتبة من الأعلى مبلغًا ({arNum(overdueTotal)})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overdueList.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{p.tenant_name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.property_name} · وحدة {p.unit_number} · استحقت {shortDate(p.due_date)}
                    {p.last_reminded_at
                      ? ` · آخر تذكير ${shortDate(p.last_reminded_at)}`
                      : " · لم يُذكَّر بعد"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-destructive">{sar(remainingOf(p))}</span>
                  {p.tenant_phone ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={`tel:${p.tenant_phone}`}>اتصال</a>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={remind.isPending || !p.tenant_user_id}
                    title={
                      p.tenant_user_id
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
            {overdueTotal > overdueList.length ? (
              <Button
                variant="link"
                className="h-auto px-0"
                onClick={() => setStatusFilter("overdue")}
              >
                عرض كل المتأخرات ({arNum(overdueTotal)}) في جدول الدفعات
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6 shadow-deed">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">
            الدفعات
            {filtered ? (
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                ({arNum(matching)} من {arNum(totals.payments_count)})
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
                    <p className="font-medium">{p.tenant_name ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      {p.property_name} · {p.unit_number} · تستحق {shortDate(p.due_date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <p className="text-end font-bold tabular-nums">{amountCell(p)}</p>
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
                    <TableCell className="font-medium">{p.tenant_name ?? "—"}</TableCell>
                    <TableCell>
                      {p.property_name} · {p.unit_number}
                    </TableCell>
                    <TableCell>{shortDate(p.due_date)}</TableCell>
                    <TableCell>
                      {amountCell(p)}
                      {transferNote(p)}
                    </TableCell>
                    <TableCell>{paymentBadge(p)}</TableCell>
                    <TableCell>{paymentAction(p, false)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pager page={page} pages={pages} busy={list.isFetching} onPage={setPage} />
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">المصروفات</CardTitle>
        </CardHeader>
        <CardContent>
          {expenses.data && expenses.data.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد مصروفات بعد.</p>
          ) : null}
          <ul className="divide-y divide-border md:hidden">
            {(expenses.data?.rows ?? []).map((e) => (
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
          <div
            className={expenses.data?.rows.length ? "hidden overflow-x-auto md:block" : "hidden"}
          >
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
                {(expenses.data?.rows ?? []).map((e) => (
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
          <Pager
            page={expensePage}
            pages={Math.max(1, Math.ceil((expenses.data?.total ?? 0) / PAGE_SIZE))}
            busy={expenses.isFetching}
            onPage={setExpensePage}
          />
        </CardContent>
      </Card>

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسجيل السداد</DialogTitle>
            <DialogDescription>
              سجّل المبلغ المستلم فعلًا. أقل من المتبقي يُسجَّل دفعة جزئية وتبقى الدفعة مفتوحة.
            </DialogDescription>
          </DialogHeader>
          {confirming ? (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/50 p-3">
                <dt className="text-muted-foreground">المستأجر</dt>
                <dd className="font-medium">{confirming.tenant_name ?? "—"}</dd>
                <dt className="text-muted-foreground">الوحدة</dt>
                <dd>
                  {confirming.property_name} · {confirming.unit_number ?? "—"}
                </dd>
                <dt className="text-muted-foreground">تاريخ الاستحقاق</dt>
                <dd>{shortDate(confirming.due_date)}</dd>
                <dt className="text-muted-foreground">مبلغ الدفعة</dt>
                <dd className="font-bold">{sar(confirming.amount)}</dd>
                {Number(confirming.amount_paid) > 0 ? (
                  <>
                    <dt className="text-muted-foreground">سُدد منها</dt>
                    <dd>
                      {sar(confirming.amount_paid)} · المتبقي {sar(confirmRemaining)}
                    </dd>
                  </>
                ) : null}
              </dl>
              {confirming.transfer_reference ? (
                <p className="text-xs text-brass">
                  المستأجر أبلغ عن تحويل: {confirming.transfer_reference}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="pay-amount">المبلغ المستلم</Label>
                  <Input
                    id="pay-amount"
                    dir="ltr"
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    aria-invalid={!!amountError}
                  />
                  {amountError ? (
                    <p className="text-xs text-destructive">{amountError}</p>
                  ) : amountValue != null && amountValue < confirmRemaining ? (
                    <p className="text-xs text-muted-foreground">
                      دفعة جزئية — يبقى {sar(confirmRemaining - amountValue)}
                    </p>
                  ) : null}
                </div>
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
            <Button variant="outline" onClick={() => setConfirming(null)}>
              إلغاء
            </Button>
            <Button
              disabled={!confirming || !!paidDateError || !!amountError || markPaid.isPending}
              onClick={() =>
                confirming &&
                amountValue != null &&
                markPaid.mutate({ id: confirming.id, amount: amountValue, method, paidDate })
              }
            >
              {markPaid.isPending ? "جارٍ التسجيل…" : "تأكيد السداد"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>رفض إبلاغ التحويل</DialogTitle>
            <DialogDescription>
              {rejecting?.tenant_name ?? "—"} · مرجع {rejecting?.transfer_reference} — يُمسح الإبلاغ
              ويصل السبب للمستأجر ليعيد التحويل أو يصحّح المرجع.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="reject-reason">سبب الرفض</Label>
            <Textarea
              id="reject-reason"
              rows={2}
              maxLength={300}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="لم يصل المبلغ إلى حساب المكتب، المرجع غير صحيح…"
            />
            {rejectReason && rejectError ? (
              <p className="text-xs text-destructive">{rejectError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              تراجع
            </Button>
            <Button
              variant="destructive"
              disabled={!rejecting || !!rejectError || rejectTransfer.isPending}
              onClick={() =>
                rejecting &&
                rejectTransfer.mutate({ id: rejecting.id, reason: rejectReason.trim() })
              }
            >
              {rejectTransfer.isPending ? "جارٍ الرفض…" : "رفض الإبلاغ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Previous/next for a server-paged list; hidden when everything fits on one page. */
function Pager({
  page,
  pages,
  busy,
  onPage,
}: {
  page: number;
  pages: number;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between gap-2 text-sm">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || page === 0}
        onClick={() => onPage(page - 1)}
      >
        السابق
      </Button>
      <span className="text-muted-foreground">
        صفحة {arNum(page + 1)} من {arNum(pages)}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        التالي
      </Button>
    </div>
  );
}
