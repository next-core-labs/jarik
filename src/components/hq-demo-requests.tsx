import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Phone, Presentation } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listDemoRequests,
  setDemoRequestStatus,
  type DemoStatus,
} from "@/lib/demo-requests.functions";
import { shortDate } from "@/lib/format";
import { phoneHref, whatsappHref } from "@/lib/market";

const STATUS_LABEL: Record<DemoStatus, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  closed: "مغلق",
};
const STATUS_VARIANT = { new: "info", contacted: "warning", closed: "secondary" } as const;

/** «احجز عرضاً توضيحياً» requests from the marketplace, for /hq → المكاتب والسوق. */
export function HqDemoRequests() {
  const list = useServerFn(listDemoRequests);
  const setStatus = useServerFn(setDemoRequestStatus);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["hq-demo-requests"], queryFn: () => list() });
  const update = useMutation({
    mutationFn: (v: { id: string; status: DemoStatus }) => setStatus({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hq-demo-requests"] }),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الحالة")),
  });
  const open = (q.data ?? []).filter((r) => r.status === "new").length;

  return (
    <Card className="mt-6 shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Presentation className="size-5" aria-hidden />
          طلبات العرض التوضيحي
          {open > 0 ? <Badge variant="info">{open} جديد</Badge> : null}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          من زر «احجز عرضاً توضيحياً» في قسم «للمكاتب العقارية» بالصفحة الرئيسية.
        </p>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {userErrorMessage(q.error, "تعذّر تحميل طلبات العرض — حاول مرة أخرى")}
          </p>
        ) : (q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">لا طلبات بعد.</p>
        ) : (
          <ul className="divide-y divide-border border border-border">
            {(q.data ?? []).map((r) => {
              const wa = whatsappHref(
                r.phone,
                `مرحبًا ${r.full_name}، معك فريق جارك بخصوص العرض التوضيحي`,
              );
              const tel = phoneHref(r.phone);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {r.full_name}
                      <Badge variant={STATUS_VARIANT[r.status as DemoStatus] ?? "secondary"}>
                        {STATUS_LABEL[r.status as DemoStatus] ?? r.status}
                      </Badge>
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {[
                        r.office_name,
                        r.city,
                        r.units_count != null ? `${r.units_count} وحدة` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                      {" · "}
                      <span dir="ltr">{r.phone}</span> · {shortDate(r.created_at)}
                    </p>
                    {r.notes ? <p className="text-sm whitespace-pre-wrap">{r.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {wa ? (
                      <Button size="sm" variant="whatsapp" asChild>
                        <a href={wa} target="_blank" rel="noreferrer">
                          <MessageCircle aria-hidden />
                          واتساب
                        </a>
                      </Button>
                    ) : null}
                    {tel ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={tel}>
                          <Phone aria-hidden />
                          اتصال
                        </a>
                      </Button>
                    ) : null}
                    <Select
                      value={r.status}
                      onValueChange={(v) => update.mutate({ id: r.id, status: v as DemoStatus })}
                    >
                      <SelectTrigger className="h-9 w-32 text-sm" aria-label="حالة الطلب">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_LABEL) as DemoStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
