import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { submitTransferNotice } from "@/lib/portal-actions.functions";
import { downloadElementAsPdf } from "@/lib/pdf";
import { arNum, daysLabel, daysUntil, sar, shortDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Payment {
  id: string;
  lease_id: string;
  amount: number;
  amount_paid: number;
  due_date: string;
  paid_date: string | null;
  status: string;
  transfer_reference: string | null;
  transfer_rejected_note: string | null;
}

/**
 * جدول دفعات عقد واحد لوحة المستأجر: حالة كل دفعة، إبلاغ عن تحويل، وإيصال PDF للمدفوعة.
 * Unpaid installments still owed on `earlierLeaseIds` (the leases this one renewed) are listed
 * above the table.
 */
export function PaymentsTable({
  leaseId,
  earlierLeaseIds = [],
}: {
  leaseId: string;
  earlierLeaseIds?: string[];
}) {
  const queryClient = useQueryClient();
  const queryKey = ["tenant-payments-table", leaseId, earlierLeaseIds];
  const [refs, setRefs] = useState<Record<string, string>>({});
  const receiptRef = useRef<HTMLDivElement>(null);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  // Every row's receipt renders into the one shared hidden node above, so two downloads started
  // close together could capture the wrong payment's content under the first one's filename — this
  // serializes them instead of letting a second click start before the first capture finishes.
  const [downloading, setDownloading] = useState(false);

  const { data: all, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, lease_id, amount, amount_paid, due_date, paid_date, status, transfer_reference, transfer_rejected_note",
        )
        .in("lease_id", [leaseId, ...earlierLeaseIds])
        .order("due_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const notifyTransfer = useMutation({
    mutationFn: useServerFn(submitTransferNotice),
    onSuccess: () => {
      toast.success("أبلغنا المكتب بالتحويل — سيُراجع ويُسجّل السداد");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الإبلاغ")),
  });

  const downloadReceipt = async (p: Payment) => {
    if (downloading) return;
    setDownloading(true);
    try {
      // Commit the receipt node now, so the ref holds this payment's receipt before the capture.
      flushSync(() => setReceipt(p));
      if (!receiptRef.current) return;
      await downloadElementAsPdf(receiptRef.current, `إيصال-${p.due_date}.pdf`);
      toast.success("نزل الإيصال PDF");
    } catch (e) {
      console.error("Receipt PDF failed", e);
      toast.error("تعذّر إنشاء الإيصال");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading || !all) return <Skeleton className="h-40" />;

  const data = all.filter((p) => p.lease_id === leaseId);
  const carried = all.filter((p) => p.lease_id !== leaseId && p.status !== "paid");
  const paidTotal = data.reduce((s, p) => s + Number(p.amount_paid), 0);
  const totalAll = data.reduce((s, p) => s + Number(p.amount), 0);

  type Row = (typeof all)[number];
  const isOverdue = (p: Row) => p.status !== "paid" && daysUntil(p.due_date) < 0;
  const statusBadge = (p: Row) => {
    const remaining = daysUntil(p.due_date);
    // "default" (الأحمر) محجوز للسعر/الإجراء الرئيسي/التوفر — لا يُستخدم لحالة كهذه.
    if (p.status === "paid") return <Badge variant="secondary">مدفوعة</Badge>;
    if (isOverdue(p)) return <Badge variant="destructive">متأخرة {daysLabel(remaining)}</Badge>;
    if (p.status === "partial") return <Badge variant="outline">مسدّدة جزئيًا</Badge>;
    if (remaining === 0) return <Badge variant="outline">مستحقة اليوم</Badge>;
    return <Badge variant="outline">بعد {daysLabel(remaining)}</Badge>;
  };
  /** The row's action, or null when there is none. `full` stretches it across a phone card. */
  const paymentAction = (p: Row, full: boolean) => {
    if (p.status === "paid") {
      return (
        <Button
          size="sm"
          variant="outline"
          className={full ? "w-full" : undefined}
          disabled={downloading}
          onClick={() => downloadReceipt(p)}
        >
          <Download className="size-4" />
          إيصال PDF
        </Button>
      );
    }
    if (!isOverdue(p)) return null;
    if (p.transfer_reference) {
      return <p className="text-xs text-muted-foreground">أبلغت — بانتظار التأكيد</p>;
    }
    const rejected = p.transfer_rejected_note ? (
      <p className="text-xs text-destructive">
        لم يعتمد المكتب إبلاغك السابق: {p.transfer_rejected_note}
      </p>
    ) : null;
    const reference = (refs[p.id] ?? "").trim();
    // The phone list and the desktop table both render this row, so the hint id says which one.
    const hintId = `transfer-ref-hint-${p.id}-${full ? "card" : "row"}`;
    return (
      <div className="space-y-1.5">
        {rejected}
        <div className="flex flex-wrap gap-2">
          <Input
            className={full ? "h-9 min-w-0 flex-1" : "h-9 max-w-40"}
            dir="ltr"
            placeholder="رقم مرجع التحويل"
            aria-label="رقم مرجع التحويل"
            aria-describedby={reference.length < 3 ? hintId : undefined}
            value={refs[p.id] ?? ""}
            onChange={(e) => setRefs((v) => ({ ...v, [p.id]: e.target.value }))}
          />
          <Button
            size="sm"
            disabled={reference.length < 3 || notifyTransfer.isPending}
            onClick={() => notifyTransfer.mutate({ data: { paymentId: p.id, reference } })}
          >
            سدّدت — أبلغ المكتب
          </Button>
        </div>
        {reference.length < 3 ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            رقم المرجع من إيصال البنك (٣ خانات على الأقل).
          </p>
        ) : null}
      </div>
    );
  };

  const amountText = (p: Row) =>
    p.status !== "paid" && Number(p.amount_paid) > 0
      ? `${sar(p.amount)} · سدّدت ${sar(p.amount_paid)}`
      : sar(p.amount);

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">جدول الدفعات</CardTitle>
      </CardHeader>
      <CardContent>
        {carried.length > 0 ? (
          <div className="mb-4 space-y-2 rounded-md border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium">متبقٍ من العقد السابق</p>
            {carried.map((p) => (
              <div key={p.id} className="flex flex-col gap-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">تستحق {shortDate(p.due_date)}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold tabular-nums">{amountText(p)}</span>
                    {statusBadge(p)}
                  </span>
                </div>
                {paymentAction(p, true)}
              </div>
            ))}
          </div>
        ) : null}
        {/* Phones: one card per payment — five columns don't fit a 390px screen. */}
        <ul className="divide-y divide-border md:hidden">
          {data.map((p, index) => (
            <li key={p.id} className="flex flex-col gap-3 py-4 first:pt-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    الدفعة {arNum(index + 1)} من {arNum(data.length)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    تستحق {shortDate(p.due_date)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <p className="font-bold tabular-nums">{amountText(p)}</p>
                  {statusBadge(p)}
                </div>
              </div>
              {paymentAction(p, true)}
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الدفعة</TableHead>
                <TableHead>تاريخ الاستحقاق</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p, index) => (
                <TableRow key={p.id}>
                  <TableCell>
                    {arNum(index + 1)} من {arNum(data.length)}
                  </TableCell>
                  <TableCell>{shortDate(p.due_date)}</TableCell>
                  <TableCell>{amountText(p)}</TableCell>
                  <TableCell>{statusBadge(p)}</TableCell>
                  <TableCell>{paymentAction(p, false) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {data.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">لا توجد دفعات.</p>
        ) : null}
        {data.length > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            المدفوع {sar(paidTotal)} من {sar(totalAll)}
          </p>
        ) : null}
      </CardContent>

      {receipt ? (
        <div
          ref={receiptRef}
          dir="rtl"
          className="pointer-events-none fixed -left-[10000px] top-0 w-[700px] bg-white p-8 text-black"
          aria-hidden="true"
        >
          <div className="border-b pb-4">
            <p className="text-lg font-bold">إيصال سداد</p>
          </div>
          <table className="mt-6 w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2 text-gray-600">تاريخ الاستحقاق</td>
                <td className="py-2 text-left font-bold">{shortDate(receipt.due_date)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">تاريخ السداد</td>
                <td className="py-2 text-left font-bold">
                  {receipt.paid_date ? shortDate(receipt.paid_date) : "—"}
                </td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">المبلغ</td>
                <td className="py-2 text-left font-bold">{sar(receipt.amount)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-6 text-xs text-gray-500">
            إيصال صادر من منصة جارك — رقم الدفعة {receipt.id}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
