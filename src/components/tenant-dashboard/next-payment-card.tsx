import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, MessageCircle, Send, Wallet } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { submitTransferNotice } from "@/lib/portal-actions.functions";
import { arNum, daysLabel, daysUntil, sar, shortDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Payment = {
  id: string;
  lease_id: string;
  amount: number;
  amount_paid: number;
  due_date: string;
  status: string;
  transfer_reference: string | null;
  transfer_rejected_note: string | null;
};

/**
 * أكبر بطاقة في لوحة المستأجر — الدفعة القادمة المستحقة على عقده، مع سداد سريع أو طلب مهلة.
 * `earlierLeaseIds`: the leases this one renewed; an installment they still owe comes first.
 */
export function NextPaymentCard({
  leaseId,
  earlierLeaseIds = [],
}: {
  leaseId: string;
  earlierLeaseIds?: string[];
}) {
  const queryClient = useQueryClient();
  const [showPayForm, setShowPayForm] = useState(false);
  const [reference, setReference] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-next-payment", leaseId, earlierLeaseIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, lease_id, amount, amount_paid, due_date, status, transfer_reference, transfer_rejected_note",
        )
        .in("lease_id", [leaseId, ...earlierLeaseIds])
        .order("due_date");
      if (error) throw error;
      return (data ?? []) as Payment[];
    },
  });

  const submitNotice = useServerFn(submitTransferNotice);
  const notifyTransfer = useMutation({
    mutationFn: (payload: { paymentId: string; reference: string }) =>
      submitNotice({ data: payload }),
    onSuccess: () => {
      toast.success("أبلغنا المكتب بالتحويل — سيُراجع ويُسجّل السداد");
      setShowPayForm(false);
      setReference("");
      queryClient.invalidateQueries({ queryKey: ["tenant-next-payment", leaseId] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الإبلاغ")),
  });

  const requestGrace = useMutation({
    mutationFn: async (payment: Payment) => {
      const { error } = await supabase.rpc("request_payment_grace", { _payment_id: payment.id });
      if (error) throw error;
    },
    onSuccess: () => toast.success("وصل طلبك للمكتب"),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الطلب")),
  });

  if (isLoading || !data) return <Skeleton className="h-48" />;

  const nextDue = data.find((p) => p.status !== "paid") ?? null;
  // «الدفعة ٣ من ٤» counts within the installment's own lease.
  const sameLease = nextDue ? data.filter((p) => p.lease_id === nextDue.lease_id) : [];
  const paymentCount = sameLease.length;
  const paymentIndex = nextDue ? sameLease.indexOf(nextDue) + 1 : 0;
  const remaining = nextDue ? Number(nextDue.amount) - Number(nextDue.amount_paid) : 0;

  if (!nextDue) {
    return (
      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">الدفعة القادمة</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-brass" />
          <p className="text-sm text-muted-foreground">لا توجد دفعة مستحقة حاليًا</p>
        </CardContent>
      </Card>
    );
  }

  const days = daysUntil(nextDue.due_date);
  const isOverdue = days < 0;
  const isToday = days === 0;

  return (
    <Card className={isOverdue ? "border-destructive/40 shadow-deed" : "shadow-deed"}>
      <CardHeader>
        <CardTitle className="text-base">الدفعة القادمة</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              الدفعة {arNum(paymentIndex)} من {arNum(paymentCount)}
              {nextDue.lease_id !== leaseId ? " · من العقد السابق" : ""}
            </p>
            <p className="mt-1 font-display text-3xl font-bold md:text-4xl">{sar(remaining)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {shortDate(nextDue.due_date)}
              {Number(nextDue.amount_paid) > 0
                ? ` · سدّدت ${sar(nextDue.amount_paid)} من ${sar(nextDue.amount)}`
                : ""}
            </p>
          </div>
          <Badge variant={isOverdue ? "destructive" : "secondary"}>
            {isOverdue
              ? `متأخرة ${daysLabel(days)}`
              : isToday
                ? "مستحقة اليوم"
                : `بعد ${daysLabel(days)}`}
          </Badge>
        </div>

        {nextDue.transfer_rejected_note && !nextDue.transfer_reference ? (
          <p className="text-sm text-destructive">
            لم يعتمد المكتب إبلاغك السابق: {nextDue.transfer_rejected_note}
          </p>
        ) : null}
        {nextDue.transfer_reference ? (
          <p className="text-sm text-brass">
            أبلغت عن تحويل: <span dir="ltr">{nextDue.transfer_reference}</span> — بانتظار تأكيد
            المكتب.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setShowPayForm((v) => !v)}>
                <Wallet className="size-4" />
                ادفع الآن
              </Button>
              <Button
                variant="outline"
                disabled={requestGrace.isPending}
                onClick={() => requestGrace.mutate(nextDue)}
              >
                <Send className="size-4" />
                اطلب مهلة أو تقسيط
              </Button>
            </div>
            {showPayForm ? (
              <div className="space-y-3 rounded-md border border-border bg-background p-3">
                {/* The office's bank account isn't stored in Jarak yet, so the tenant gets it from
                    the office; the amount is the one thing we can state with certainty. */}
                <div className="space-y-1 text-sm">
                  <p>
                    المبلغ المطلوب تحويله: <span className="font-bold">{sar(remaining)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    حوّل المبلغ إلى حساب المكتب البنكي. إن لم تكن لديك بيانات الحساب فاطلبها من
                    المكتب في المحادثات، ثم اكتب رقم مرجع التحويل هنا.
                  </p>
                  <Button size="sm" variant="link" className="h-auto px-0" asChild>
                    <Link to="/messages">
                      <MessageCircle className="size-4" />
                      راسل المكتب
                    </Link>
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input
                    className="h-9 max-w-52"
                    placeholder="رقم مرجع التحويل"
                    aria-describedby="transfer-ref-hint"
                    dir="ltr"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={reference.trim().length < 3 || notifyTransfer.isPending}
                    onClick={() =>
                      notifyTransfer.mutate({ paymentId: nextDue.id, reference: reference.trim() })
                    }
                  >
                    سدّدت — أبلغ المكتب
                  </Button>
                </div>
                {reference.trim().length < 3 ? (
                  <p id="transfer-ref-hint" className="text-xs text-muted-foreground">
                    اكتب رقم مرجع التحويل من إيصال البنك (٣ خانات على الأقل) لتفعيل زر الإبلاغ.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
