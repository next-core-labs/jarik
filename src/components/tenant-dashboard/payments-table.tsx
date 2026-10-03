import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { submitTransferNotice } from "@/lib/portal-actions.functions";
import { downloadElementAsPdf } from "@/lib/pdf";
import { sar, shortDate, daysUntil } from "@/lib/format";
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
  amount: number;
  due_date: string;
  paid_date: string | null;
  status: string;
  transfer_reference: string | null;
}

/** جدول دفعات عقد واحد لوحة المستأجر: حالة كل دفعة، إبلاغ عن تحويل، وإيصال PDF للمدفوعة. */
export function PaymentsTable({ leaseId }: { leaseId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["tenant-payments-table", leaseId];
  const [refs, setRefs] = useState<Record<string, string>>({});
  const receiptRef = useRef<HTMLDivElement>(null);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  // Every row's receipt renders into the one shared hidden node above, so two downloads started
  // close together could capture the wrong payment's content under the first one's filename — this
  // serializes them instead of letting a second click start before the first capture finishes.
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount, due_date, paid_date, status, transfer_reference")
        .eq("lease_id", leaseId)
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
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال الإبلاغ"),
  });

  const downloadReceipt = async (p: Payment) => {
    if (downloading) return;
    setDownloading(true);
    setReceipt(p);
    try {
      await new Promise((r) => setTimeout(r, 120));
      if (!receiptRef.current) return;
      await downloadElementAsPdf(receiptRef.current, `إيصال-${p.due_date}.pdf`);
      toast.success("نزل الإيصال PDF");
    } catch {
      toast.error("تعذّر إنشاء الإيصال");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading || !data) return <Skeleton className="h-40" />;

  const paidTotal = data.reduce((s, p) => (p.status === "paid" ? s + Number(p.amount) : s), 0);
  const totalAll = data.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">جدول الدفعات</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
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
            {data.map((p, index) => {
              const remaining = daysUntil(p.due_date);
              const overdue = p.status !== "paid" && remaining < 0;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    {index + 1} من {data.length}
                  </TableCell>
                  <TableCell>{shortDate(p.due_date)}</TableCell>
                  <TableCell>{sar(p.amount)}</TableCell>
                  <TableCell>
                    {p.status === "paid" ? (
                      // "default" (الأحمر) محجوز للسعر/الإجراء الرئيسي/التوفر — لا يُستخدم لحالة كهذه.
                      <Badge variant="secondary">مدفوعة</Badge>
                    ) : overdue ? (
                      <Badge variant="destructive">متأخرة {Math.abs(remaining)} يوم</Badge>
                    ) : (
                      <Badge variant="outline">بعد {remaining} يوم</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.status === "paid" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={downloading}
                        onClick={() => downloadReceipt(p)}
                      >
                        <Download className="size-4" />
                        إيصال PDF
                      </Button>
                    ) : overdue ? (
                      p.transfer_reference ? (
                        <p className="text-xs text-muted-foreground">أبلغت — بانتظار التأكيد</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Input
                            className="h-9 max-w-40"
                            dir="ltr"
                            placeholder="رقم مرجع التحويل"
                            value={refs[p.id] ?? ""}
                            onChange={(e) => setRefs((v) => ({ ...v, [p.id]: e.target.value }))}
                          />
                          <Button
                            size="sm"
                            disabled={
                              (refs[p.id] ?? "").trim().length < 3 || notifyTransfer.isPending
                            }
                            onClick={() =>
                              notifyTransfer.mutate({
                                data: {
                                  paymentId: p.id,
                                  reference: (refs[p.id] ?? "").trim(),
                                },
                              })
                            }
                          >
                            سدّدت — أبلغ المكتب
                          </Button>
                        </div>
                      )
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
