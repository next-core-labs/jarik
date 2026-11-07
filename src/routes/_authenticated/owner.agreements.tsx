import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Handshake } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PERMISSION_LABEL,
  PERMISSION_OPTIONS,
  UNENFORCED_PERMISSIONS,
} from "@/lib/agreement-permissions";
import { daysLabel, sar, shortDate } from "@/lib/format";
import { RequestAgreementDialog } from "@/components/request-agreement-dialog";
import { useOwnerUnitGroups } from "@/lib/owner-units";
import { accessEndsAt, agreementPhase, heldAgreementUnitIds } from "@/lib/agreement-live";

export const Route = createFileRoute("/_authenticated/owner/agreements")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "اتفاقيات إدارة الأملاك — جارك" },
      {
        name: "description",
        content: "اطلب من مكتب عقاري إدارة وحداتك، وتابع اتفاقياتك السارية وصلاحياتها.",
      },
    ],
  }),
  component: OwnerAgreements,
});

const STATUS_LABEL: Record<string, string> = {
  sent: "بانتظار رد المكتب",
  office_modified: "عدّل المكتب الشروط — بانتظار قرارك",
  active: "سارية",
  rejected: "مرفوضة",
  cancelled: "ملغاة",
  ended: "منتهية",
};
const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  sent: "secondary",
  office_modified: "secondary",
  active: "default",
  rejected: "destructive",
  cancelled: "outline",
  ended: "outline",
};

type AgreementRow = {
  id: string;
  status: string;
  commission_type: string;
  commission_value: number;
  start_date: string;
  end_date: string | null;
  notice_period_days: number;
  maintenance_cap: number | null;
  termination_requested_at: string | null;
  termination_requested_by: string | null;
  org_id: string;
  owner_note: string | null;
  office_note: string | null;
  agreement_units: {
    unit_id: string;
    units: { unit_number: string; properties: { name: string } | null } | null;
  }[];
  agreement_permissions: { permission: string }[];
  agreement_change_requests: {
    kind: string;
    status: string;
    payload: { permission?: string } | null;
  }[];
};

/** Permissions the owner asked to add and the office hasn't answered yet. */
function pendingWidenPermissions(a: AgreementRow): string[] {
  return a.agreement_change_requests
    .filter((r) => r.kind === "permission_widen" && r.status === "pending")
    .map((r) => r.payload?.permission ?? "")
    .filter(Boolean);
}

/** The badge: «سارية» only while the agreement is really in force (dates and notice period). */
function statusBadge(a: AgreementRow): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  const phase = agreementPhase(a);
  if (phase === "upcoming")
    return { label: `تبدأ ${shortDate(a.start_date)}`, variant: "secondary" };
  if (phase === "over") return { label: "منتهية", variant: "outline" };
  return {
    label: STATUS_LABEL[a.status] ?? a.status,
    variant: STATUS_BADGE_VARIANT[a.status] ?? "outline",
  };
}

function OwnerAgreements() {
  const queryClient = useQueryClient();
  const [requestOpen, setRequestOpen] = useState(false);
  const [editingPerms, setEditingPerms] = useState<AgreementRow | null>(null);

  const agreements = useQuery({
    queryKey: ["owner-agreements"],
    queryFn: async (): Promise<AgreementRow[]> => {
      const { data, error } = await supabase
        .from("management_agreements")
        .select(
          "id, status, commission_type, commission_value, start_date, end_date, notice_period_days, maintenance_cap, termination_requested_at, termination_requested_by, org_id, owner_note, office_note, agreement_units(unit_id, units(unit_number, properties(name))), agreement_permissions(permission), agreement_change_requests(kind, status, payload)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AgreementRow[];
    },
  });

  // office_directory (تضمين FK مباشر أبسط) يكشف فقط مكاتب listed_publicly AND verified — لو
  // المكتب أوقف الإدراج أو فقد التوثيق بعد ما توقّع الاتفاقية، اسمه يختفي من هنا رغم أن العلاقة
  // حقيقية. my_agreement_offices() مقصورة على اتفاقيات المالك المتصل نفسه، بلا هذا الشرط.
  const officeNames = useQuery({
    queryKey: ["owner-agreements-office-names"],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.rpc("my_agreement_offices");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) map[row.org_id] = row.company_name;
      return map;
    },
  });

  const properties = useOwnerUnitGroups();
  const unitsUnderActiveAgreement = useMemo(
    () => heldAgreementUnitIds(agreements.data ?? []),
    [agreements.data],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["owner-agreements"] });
  };

  const terminate = useMutation({
    mutationFn: async (agreementId: string) => {
      const { error } = await supabase.rpc("request_agreement_termination", {
        _agreement_id: agreementId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("سُجّل طلب إنهاء الاتفاقية — تُطبَّق فعليًا بعد فترة الإشعار");
      refresh();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تسجيل طلب الإنهاء")),
  });

  const cancelRequest = useMutation({
    mutationFn: async (agreementId: string) => {
      const { error } = await supabase.rpc("owner_cancel_agreement_request", {
        _agreement_id: agreementId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("سُحب الطلب — وصل المكتبَ إشعار بذلك");
      refresh();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر سحب الطلب")),
  });

  const decideCounter = useMutation({
    mutationFn: async (v: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc("owner_decide_countered_agreement", {
        _agreement_id: v.id,
        _decision: v.accept ? "accept" : "reject",
      });
      if (error) throw error;
    },
    onSuccess: (_v, v) => {
      toast.success(v.accept ? "قُبلت الشروط — الاتفاقية سارية الآن" : "رُفض التعديل");
      refresh();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تسجيل القرار")),
  });

  const list = agreements.data ?? [];

  return (
    <>
      <PageHeader
        title="اتفاقيات إدارة الأملاك"
        subtitle="اطلب من مكتب عقاري يدير وحداتك بالصلاحيات التي تحددها، وتابع اتفاقياتك السارية."
        action={
          <Button disabled={properties.isLoading} onClick={() => setRequestOpen(true)}>
            <Handshake className="size-4" />
            طلب اتفاقية إدارة
          </Button>
        }
      />

      {agreements.isLoading || properties.isLoading ? (
        <Skeleton className="h-64" />
      ) : agreements.error || properties.error ? (
        <p className="text-destructive">
          {userErrorMessage(agreements.error ?? properties.error, "تعذّر التحميل — حاول مرة أخرى")}
        </p>
      ) : (
        <div className="space-y-4">
          {list.length === 0 ? (
            <Card className="shadow-deed">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                ما عندك أي طلب اتفاقية إدارة بعد. اضغط «طلب اتفاقية إدارة» واختر مكتبًا يدير وحداتك.
              </CardContent>
            </Card>
          ) : (
            list.map((a) => {
              const phase = agreementPhase(a);
              const badge = statusBadge(a);
              const pendingPerms = pendingWidenPermissions(a);
              const accessEnds = accessEndsAt(a);
              return (
                <Card key={a.id} className="shadow-deed">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-md bg-muted text-brass">
                          <Building2 className="size-5" />
                        </span>
                        <div>
                          <CardTitle className="text-base font-display">
                            {officeNames.data?.[a.org_id] ?? "مكتب"}
                          </CardTitle>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {a.agreement_units.length} وحدة ·{" "}
                            {a.commission_type === "percent"
                              ? `عمولة ${a.commission_value}%`
                              : `عمولة ${sar(a.commission_value)} ثابتة`}
                          </p>
                        </div>
                      </div>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {shortDate(a.start_date)} —{" "}
                      {a.end_date ? shortDate(a.end_date) : "بلا تاريخ انتهاء"}
                      {" · "}فترة إشعار الإنهاء {daysLabel(a.notice_period_days)}
                      {a.maintenance_cap != null
                        ? ` · سقف صيانة بلا موافقة ${sar(a.maintenance_cap)}`
                        : ""}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {a.agreement_permissions.length === 0 ? (
                        <Badge variant="outline">بلا صلاحيات محددة (عرض فقط)</Badge>
                      ) : (
                        a.agreement_permissions.map((p) => (
                          <Badge key={p.permission} variant="secondary">
                            {PERMISSION_LABEL[p.permission] ?? p.permission}
                          </Badge>
                        ))
                      )}
                      {phase === "live" || phase === "upcoming"
                        ? pendingPerms.map((p) => (
                            <Badge key={`pending-${p}`} variant="outline">
                              {PERMISSION_LABEL[p] ?? p} — بانتظار موافقة المكتب
                            </Badge>
                          ))
                        : null}
                    </div>
                    {a.owner_note ? (
                      <p className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">رسالتك: </span>
                        {a.owner_note}
                      </p>
                    ) : null}
                    {a.office_note ? (
                      <p className="rounded-md border border-border px-3 py-2 text-sm">
                        <span className="text-muted-foreground">ردّ المكتب: </span>
                        {a.office_note}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {a.agreement_units.map((au) => (
                        <span
                          key={au.unit_id}
                          className="rounded-md border border-border px-2 py-1"
                        >
                          {au.units?.properties?.name ?? ""} · وحدة {au.units?.unit_number ?? "—"}
                        </span>
                      ))}
                    </div>

                    {phase === "pending" ? (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {a.status === "office_modified" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={decideCounter.isPending}
                              onClick={() => decideCounter.mutate({ id: a.id, accept: true })}
                            >
                              قبول التعديل
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={decideCounter.isPending}
                              onClick={() => decideCounter.mutate({ id: a.id, accept: false })}
                            >
                              رفض
                            </Button>
                          </>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={cancelRequest.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `سحب طلب الإدارة المرسل إلى ${officeNames.data?.[a.org_id] ?? "المكتب"}؟ يُلغى الطلب ويصل المكتبَ إشعار بذلك.`,
                              )
                            ) {
                              cancelRequest.mutate(a.id);
                            }
                          }}
                        >
                          سحب الطلب
                        </Button>
                      </div>
                    ) : null}

                    {phase === "live" || phase === "upcoming" ? (
                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => setEditingPerms(a)}>
                          تعديل الصلاحيات
                        </Button>
                        {a.termination_requested_at ? (
                          <p className="flex items-center text-xs text-muted-foreground">
                            طلب إنهاء مسجّل (
                            {a.termination_requested_by === "owner" ? "منك" : "من المكتب"}) — تنتهي
                            الاتفاقية في {shortDate(accessEnds?.toISOString())}.
                          </p>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            disabled={terminate.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `طلب إنهاء الاتفاقية مع ${officeNames.data?.[a.org_id] ?? "المكتب"}؟ تبقى سارية لفترة الإشعار (${daysLabel(a.notice_period_days)}) قبل أن ينقطع الوصول فعليًا.`,
                                )
                              ) {
                                terminate.mutate(a.id);
                              }
                            }}
                          >
                            طلب الإنهاء
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {requestOpen ? (
        <RequestAgreementDialog
          properties={properties.data ?? []}
          excludedUnitIds={unitsUnderActiveAgreement}
          onClose={() => setRequestOpen(false)}
          onDone={() => {
            setRequestOpen(false);
            refresh();
          }}
        />
      ) : null}

      {editingPerms ? (
        <EditPermissionsDialog
          agreement={editingPerms}
          officeName={officeNames.data?.[editingPerms.org_id] ?? "المكتب"}
          onClose={() => setEditingPerms(null)}
          onDone={() => {
            setEditingPerms(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function EditPermissionsDialog({
  agreement,
  officeName,
  onClose,
  onDone,
}: {
  agreement: AgreementRow;
  officeName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const granted = new Set(agreement.agreement_permissions.map((p) => p.permission));
  const awaiting = new Set(pendingWidenPermissions(agreement));
  // Asked-for permissions stay ticked: saving without them withdraws the request.
  const [permissions, setPermissions] = useState<Set<string>>(new Set([...granted, ...awaiting]));
  const togglePermission = (p: string) =>
    setPermissions((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("update_agreement_permissions", {
        _agreement_id: agreement.id,
        _permissions: Array.from(permissions),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("حُفظت الصلاحيات — أي توسيع يحتاج موافقة المكتب أولًا");
      onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحفظ")),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">تعديل الصلاحيات</DialogTitle>
          <DialogDescription>
            {officeName} — تقليص الصلاحيات فوري، وتوسيعها يحتاج موافقة المكتب. إزالة صلاحية بانتظار
            الموافقة تسحب طلبها.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-2">
          {PERMISSION_OPTIONS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <Checkbox checked={permissions.has(p)} onCheckedChange={() => togglePermission(p)} />
              {PERMISSION_LABEL[p]}
              {UNENFORCED_PERMISSIONS.has(p) ? (
                <Badge variant="outline" className="text-xs">
                  قريبًا
                </Badge>
              ) : null}
              {awaiting.has(p) && !granted.has(p) ? (
                <Badge variant="outline" className="text-xs">
                  بانتظار المكتب
                </Badge>
              ) : null}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
