import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BadgeCheck,
  BellRing,
  Building2,
  ChevronDown,
  Mail,
  MessageCircle,
  Phone,
} from "lucide-react";
import { toast } from "sonner";

import { useServerFn } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { hqSendReminderEmails } from "@/lib/reminder-emails.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { userErrorMessage } from "@/lib/auth-errors";
import { shortDate } from "@/lib/format";
import { phoneHref, whatsappHref } from "@/lib/market";
import {
  blockerInfo,
  funnelSteps,
  reminderNote,
  type ActivationRow as Row,
} from "@/lib/office-activation";
import { cn } from "@/lib/utils";

/**
 * «تفعيل المكاتب» في /hq: لماذا لا ينشر هذا المكتب عروضًا؟ صف لكل مكتب مع العقبة الأولى وما يُفعل
 * بها، مرتّبة بالأقرب للنشر. الأرقام من hq_office_activation، وهي تتبع شروط vacant_units_public
 * حرفيًا — فما تقوله اللوحة هو ما يراه الزائر.
 */

function Funnel({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      {funnelSteps(r).map(([label, n], i) => (
        <span key={label} className="flex items-center gap-1.5">
          {i > 0 ? <span className="text-muted-foreground/50">←</span> : null}
          <span
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 tabular-nums",
              n === 0 ? "bg-muted font-semibold text-muted-foreground" : "text-muted-foreground",
            )}
          >
            {label} <span className="font-bold text-foreground">{n}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

export function HqOfficeActivation() {
  const queryClient = useQueryClient();
  const [showActive, setShowActive] = useState(false);

  const activation = useQuery({
    queryKey: ["hq-office-activation"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("hq_office_activation");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  // حالة بريد التذكير: الفشل يجب أن يُرى، فإشعار داخلي وحده لا يصل لمكتب لا يفتح المنصة.
  const emails = useQuery({
    queryKey: ["hq-reminder-emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("office_reminder_emails")
        .select("org_id, status, stage, sent_at, error, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  // التصريف اليدوي: نفس ما يفعله الـcron يوميًا، ليُجرَّب الآن بلا انتظار.
  const drain = useServerFn(hqSendReminderEmails);
  const sendNow = useMutation({
    mutationFn: async () => await drain({ data: undefined }),
    onSuccess: async (r) => {
      if (r.sent === 0 && r.failed === 0) toast.info("لا بريد في الانتظار");
      else if (r.failed === 0) toast.success(`أُرسل ${r.sent} بريد تذكير`);
      else toast.warning(`أُرسل ${r.sent} وفشل ${r.failed} — راجع السطور أدناه`);
      await queryClient.invalidateQueries({ queryKey: ["hq-reminder-emails"] });
      await queryClient.invalidateQueries({ queryKey: ["hq-office-activation"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال البريد")),
  });

  const verify = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("hq_set_office_verified", {
        _org: id,
        _verified: true,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("تم توثيق المكتب — عروضه تظهر للجمهور الآن");
      await queryClient.invalidateQueries({ queryKey: ["hq-office-activation"] });
      await queryClient.invalidateQueries({ queryKey: ["hq-offices"] });
      await queryClient.invalidateQueries({ queryKey: ["market"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر توثيق المكتب")),
  });

  const all = activation.data ?? [];
  const emailByOrg = new Map<string, { sent: number; failed: number; pending: number }>();
  for (const e of emails.data ?? []) {
    if (!e.org_id) continue;
    const acc = emailByOrg.get(e.org_id) ?? { sent: 0, failed: 0, pending: 0 };
    if (e.status === "sent") acc.sent += 1;
    else if (e.status === "failed") acc.failed += 1;
    else acc.pending += 1;
    emailByOrg.set(e.org_id, acc);
  }
  const blocked = all.filter((o) => o.blocker !== null);
  const active = all.filter((o) => o.blocker === null);
  const liveTotal = active.reduce((s, o) => s + o.live, 0);
  // المكاتب التي تحلّها المنصة بضغطة — أهم رقم في اللوحة.
  const oneClick = blocked.filter((o) => o.blocker === "not_verified");

  return (
    <Card className="shadow-deed">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">تفعيل المكاتب — لماذا لا تنشر عروضًا؟</CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={sendNow.isPending}
            onClick={() => sendNow.mutate()}
          >
            <Mail className="size-4" />
            {sendNow.isPending ? "جارٍ الإرسال…" : "أرسل بريد التذكير الآن"}
          </Button>
        </div>
        {activation.isLoading ? null : (
          <p className="mt-1 text-xs text-muted-foreground">
            {active.length} مكتب ينشر ({liveTotal} عرض ظاهر للزائر) · {blocked.length} متوقف
            {oneClick.length > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-foreground">
                  {oneClick.length} بانتظار توثيقك
                </span>
              </>
            ) : null}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {activation.isLoading ? (
          <Skeleton className="h-40" />
        ) : activation.error ? (
          <p className="text-sm text-destructive">تعذّر تحميل لوحة التفعيل.</p>
        ) : blocked.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            كل المكاتب المسجّلة تنشر عروضًا — لا شيء متوقف.
          </p>
        ) : (
          blocked.map((o) => {
            const b = blockerInfo(o.blocker)!;
            const tel = phoneHref(o.office_phone);
            const wa = whatsappHref(
              o.whatsapp_number ?? o.office_phone,
              `مرحبًا${o.company_name ? ` ${o.company_name}` : ""}، من فريق جارك — نساعدك في نشر عروضك على المنصة.`,
            );
            return (
              <div
                key={o.id}
                className={cn(
                  "flex flex-col gap-2.5 rounded-lg border p-4",
                  b.tone === "action"
                    ? "border-brass bg-brass/5"
                    : b.tone === "ok"
                      ? "border-border bg-muted/20"
                      : "border-border",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <Building2 className="size-4 shrink-0 text-brass" aria-hidden />
                      {o.company_name || "مكتب بلا اسم"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[o.city, o.district].filter(Boolean).join(" — ") || "بلا عنوان"} · سُجّل{" "}
                      {shortDate(o.created_at)}
                      {o.manager_email ? ` · ${o.manager_email}` : ""}
                    </p>
                  </div>
                  <Badge variant={b.tone === "action" ? "default" : "outline"}>{b.label}</Badge>
                </div>

                <Funnel r={o} />

                <p className="text-sm text-muted-foreground">{b.todo}</p>

                {/* حالة التذكير التلقائي: حتى لا يتصل الفريق بمكتب ذُكّر للتو، ويعرف من استُنفدت
                    تذكيراته فيحتاج تواصلًا بشريًا. */}
                {reminderNote(o) ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <BellRing className="size-3.5 shrink-0 text-brass" aria-hidden />
                    {reminderNote(o)}
                    {o.last_reminder_at ? ` آخره ${shortDate(o.last_reminder_at)}.` : ""}
                  </p>
                ) : null}

                {(() => {
                  const mail = emailByOrg.get(o.id);
                  if (!mail) return null;
                  return (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="size-3.5 shrink-0 text-brass" aria-hidden />
                      {mail.sent > 0 ? `وصل ${mail.sent} بريد` : "لم يصل بريد"}
                      {mail.pending > 0 ? ` · ${mail.pending} في الانتظار` : ""}
                      {mail.failed > 0 ? (
                        <span className="font-semibold text-destructive">
                          {` · ${mail.failed} فشل الإرسال`}
                        </span>
                      ) : null}
                    </p>
                  );
                })()}

                <div className="flex flex-wrap gap-2">
                  {o.blocker === "not_verified" ? (
                    <Button
                      size="sm"
                      disabled={verify.isPending}
                      onClick={() => verify.mutate(o.id)}
                    >
                      <BadgeCheck className="size-4" />
                      وثّق المكتب ({o.vacant_priced} عرض جاهز)
                    </Button>
                  ) : null}
                  {tel ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={tel}>
                        <Phone className="size-4" />
                        {o.office_phone}
                      </a>
                    </Button>
                  ) : null}
                  {wa ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={wa} target="_blank" rel="noreferrer">
                        <MessageCircle className="size-4" />
                        واتساب
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}

        {active.length > 0 ? (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowActive((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown
                className={cn("size-4 transition-transform", showActive && "rotate-180")}
                aria-hidden
              />
              {active.length} مكتب ينشر عروضًا
            </button>
            {showActive ? (
              <ul className="mt-2 divide-y divide-border">
                {active.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="font-medium">{o.company_name || "مكتب بلا اسم"}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {o.live} عرض ظاهر · {o.live_with_photos} بصور
                      {o.live > o.live_with_photos ? (
                        <span className="font-semibold text-foreground">
                          {" "}
                          · {o.live - o.live_with_photos} بلا صور
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
