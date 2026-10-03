import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, LogOut } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { submitRenewalDecision } from "@/lib/office-tools.functions";
import { sar, daysUntil } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

const depositLabel: Record<string, string> = {
  held: "محجوزة",
  refunded: "مستردة",
  deducted: "مخصومة",
};

/** بطاقة المستأجر: قرار التجديد قبل انتهاء العقد + حالة وديعة التأمين. */
export function RenewalDecision() {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["renewal-decision"],
    queryFn: async () => {
      const [leases, requests] = await Promise.all([
        supabase
          .from("leases")
          .select(
            "id, end_date, annual_rent, deposit, deposit_status, deposit_note, units(unit_number, properties(name))",
          )
          .eq("status", "active")
          .order("end_date"),
        supabase.from("renewal_requests").select("id, lease_id, decision, status"),
      ]);
      return {
        leases: (leases.data ?? []) as unknown as {
          id: string;
          end_date: string;
          annual_rent: number;
          deposit: number;
          deposit_status: string;
          deposit_note: string | null;
          units: { unit_number: string; properties: { name: string } | null } | null;
        }[],
        requests: (requests.data ?? []) as {
          id: string;
          lease_id: string;
          decision: string;
          status: string;
        }[],
      };
    },
  });

  const decide = useMutation({
    mutationFn: (payload: { leaseId: string; decision: "renew" | "leave"; note?: string }) =>
      submitRenewalDecision({ data: payload }),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.decision === "renew"
          ? "أبلغنا المكتب برغبتك في التجديد — سيتواصلون معك لإنهاء العقد الجديد"
          : "أبلغنا المكتب بطلب المغادرة",
      );
      queryClient.invalidateQueries({ queryKey: ["renewal-decision"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال قرارك"),
  });

  if (isLoading || !data) return <Skeleton className="mb-6 h-40" />;

  const soon = data.leases.filter((l) => daysUntil(l.end_date) <= 90);
  const pending = soon.filter((l) => !data.requests.some((r) => r.lease_id === l.id));
  const decided = soon.filter((l) => data.requests.some((r) => r.lease_id === l.id));

  if (soon.length === 0 && data.leases.every((l) => !Number(l.deposit))) {
    // لا عقد قارب على الانتهاء ولا وديعة معلّقة — نوضّح متى يظهر خيار التجديد/الإخلاء بدل ما
    // نخفي القسم بالكامل بصمت (معيار القبول: "قبل ذلك يظهر سطر يوضح متى بتظهر هذه الخيارات").
    if (data.leases.length === 0) return null;
    return (
      <Card className="mb-6 shadow-deed">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <CalendarCheck className="size-4 shrink-0 text-brass" />
          خيارات التجديد أو الإخلاء تظهر هنا قبل 90 يومًا من نهاية عقدك.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6 shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="size-4 text-brass" />
          عقدك ووديعة التأمين
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {soon.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            لا يوجد عقد قارب على الانتهاء خلال 90 يومًا.
          </p>
        ) : null}
        {soon.map((l) => {
          const days = daysUntil(l.end_date);
          const hasDecision = !pending.includes(l);
          const myRequest = data.requests.find((r) => r.lease_id === l.id);
          return (
            <div key={l.id} className="rounded-md border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {l.units?.properties?.name} · وحدة {l.units?.unit_number}
                </p>
                <Badge variant={days < 0 ? "destructive" : days <= 30 ? "secondary" : "outline"}>
                  {days < 0 ? `منتهٍ منذ ${Math.abs(days)} يوم` : `ينتهي بعد ${days} يوم`}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                الإيجار {sar(l.annual_rent)} · الوديعة {sar(l.deposit)} —{" "}
                {depositLabel[l.deposit_status] ?? l.deposit_status}
                {l.deposit_note ? ` (${l.deposit_note})` : ""}
              </p>
              {hasDecision && myRequest ? (
                <p className="mt-2 text-sm text-brass">
                  {myRequest.decision === "renew"
                    ? "وصل قرارك (الموافقة على التجديد) للمكتب"
                    : "وصل قرارك (طلب المغادرة) للمكتب"}
                  {myRequest.status === "handled" ? " — تمت معالجته" : ""}
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  <Textarea
                    rows={2}
                    placeholder="ملاحظة للمكتب (اختياري)"
                    value={notes[l.id] ?? ""}
                    onChange={(e) => setNotes((s) => ({ ...s, [l.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          leaseId: l.id,
                          decision: "renew",
                          ...(notes[l.id] ? { note: notes[l.id] } : {}),
                        })
                      }
                    >
                      <CalendarCheck className="size-4" />
                      أوافق على التجديد
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          leaseId: l.id,
                          decision: "leave",
                          ...(notes[l.id] ? { note: notes[l.id] } : {}),
                        })
                      }
                    >
                      <LogOut className="size-4" />
                      أطلب المغادرة
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {decided.length === 0 && soon.length === 0 && data.leases.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            ودائع عقودك تظهر هنا مع حالتها (محجوزة / مستردة / مخصومة).
          </p>
        ) : null}
        {soon.length === 0 && data.leases.some((l) => Number(l.deposit)) ? (
          <div className="space-y-2">
            {data.leases
              .filter((l) => Number(l.deposit))
              .map((l) => (
                <p key={l.id} className="text-sm text-muted-foreground">
                  {l.units?.properties?.name} · وحدة {l.units?.unit_number} — وديعة {sar(l.deposit)}{" "}
                  ({depositLabel[l.deposit_status] ?? l.deposit_status})
                  {l.deposit_note ? ` · ${l.deposit_note}` : ""}
                </p>
              ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
