import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Handshake, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { unitSpecsLine } from "@/components/unit-specs-summary";
import { FURNISHING_LABEL, furnitureSummary, isFurnishing, parseFurniture } from "@/lib/furniture";
import {
  PERMISSION_LABEL,
  PERMISSION_OPTIONS,
  UNENFORCED_PERMISSIONS,
} from "@/lib/agreement-permissions";
import { sar, shortDate } from "@/lib/format";
import { isStaffRole, useMyRoles } from "@/lib/use-role";

export const Route = createFileRoute("/_authenticated/agreements")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "اتفاقيات الإدارة — جارك" },
      { name: "description", content: "طلبات إدارة أملاك واردة من ملاك، واتفاقياتك السارية معهم." },
    ],
  }),
  component: OfficeAgreements,
});

type AgreementRequest = {
  id: string;
  owner_name: string | null;
  owner_email: string;
  status: string;
  commission_type: string;
  commission_value: number;
  start_date: string;
  end_date: string | null;
  notice_period_days: number;
  maintenance_cap: number | null;
  termination_requested_at: string | null;
  termination_requested_by: string | null;
  units_count: number;
  units: RequestUnit[];
  permissions: string[];
  created_at: string;
  owner_note: string | null;
  office_note: string | null;
};

/** One unit the owner asks the office to manage, as office_agreement_requests() describes it. */
type RequestUnit = {
  unit_id: string;
  unit_number: string;
  unit_name: string | null;
  unit_type: string;
  property_name: string | null;
  property_structure: string | null;
  city: string | null;
  district: string | null;
  floor_no: string | null;
  area: number | null;
  rooms: number | null;
  halls: number | null;
  bathrooms: number | null;
  furnishing: string | null;
  furniture: unknown;
  annual_rent: number | null;
  listing_purpose: string | null;
  sale_price: number | null;
  status: string | null;
  deed_number: string | null;
};

type ChangeRequest = {
  id: string;
  kind: string;
  payload: { permission?: string };
  status: string;
  created_at: string;
  agreement_id: string;
  management_agreements: {
    agreement_units: {
      units: { unit_number: string; properties: { name: string } | null } | null;
    }[];
  } | null;
};

function OfficeAgreements() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const staff = isStaffRole(me?.roles ?? []);
  const [countering, setCountering] = useState<AgreementRequest | null>(null);
  const [deciding, setDeciding] = useState<{
    agreement: AgreementRequest;
    decision: "accept" | "reject";
  } | null>(null);

  const requests = useQuery({
    queryKey: ["office-agreement-requests"],
    enabled: staff,
    queryFn: async (): Promise<AgreementRequest[]> => {
      const { data, error } = await supabase.rpc("office_agreement_requests");
      if (error) throw error;
      return (data ?? []) as unknown as AgreementRequest[];
    },
  });

  const changeRequests = useQuery({
    queryKey: ["office-agreement-change-requests"],
    enabled: staff,
    queryFn: async (): Promise<ChangeRequest[]> => {
      const { data, error } = await supabase
        .from("agreement_change_requests")
        .select(
          "id, kind, payload, status, created_at, agreement_id, management_agreements(agreement_units(units(unit_number, properties(name))))",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ChangeRequest[];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["office-agreement-requests"] });
    queryClient.invalidateQueries({ queryKey: ["office-agreement-change-requests"] });
    queryClient.invalidateQueries({ queryKey: ["office-nav-pending-agreements"] });
    queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
  };

  const respond = useMutation({
    mutationFn: async (v: { id: string; decision: "accept" | "reject"; note: string }) => {
      const { error } = await supabase.rpc("office_respond_agreement", {
        _agreement_id: v.id,
        _decision: v.decision,
        ...(v.note.trim() ? { _note: v.note.trim() } : {}),
      });
      if (error) throw error;
      return v;
    },
    onSuccess: (v) => {
      toast.success(
        v.decision === "accept"
          ? "قُبل الطلب — الاتفاقية سارية ووحدات المالك ظاهرة في «الأملاك والوحدات»"
          : "رُفض الطلب — وصل المالكَ إشعار بالرد",
      );
      setDeciding(null);
      refresh();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تنفيذ القرار")),
  });

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

  const decideChange = useMutation({
    mutationFn: async (v: { id: string; decision: "approve" | "reject" }) => {
      const { error } = await supabase.rpc("office_decide_change_request", {
        _request_id: v.id,
        _decision: v.decision,
      });
      if (error) throw error;
      return v;
    },
    onSuccess: (v) => {
      toast.success(v.decision === "approve" ? "وُسِّعت الصلاحية" : "رُفض التوسيع");
      refresh();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تسجيل القرار")),
  });

  if (me && !staff) {
    return (
      <>
        <PageHeader title="اتفاقيات الإدارة" />
        <p className="text-muted-foreground">هذه الشاشة لموظفي المكتب.</p>
      </>
    );
  }

  const list = requests.data ?? [];
  const incoming = list.filter((a) => a.status === "sent" || a.status === "office_modified");
  const active = list.filter((a) => a.status === "active");
  const rejected = list.filter((a) => a.status === "rejected");
  const pendingChanges = changeRequests.data ?? [];

  return (
    <>
      <PageHeader
        title="اتفاقيات الإدارة"
        subtitle="طلبات إدارة أملاك واردة من ملاك، واتفاقياتك السارية معهم — لا تظهر هنا أي اتفاقية لمكتب آخر."
      />

      {requests.isLoading ? (
        <Skeleton className="h-64" />
      ) : requests.error ? (
        <p className="text-destructive">
          {userErrorMessage(requests.error, "تعذّر تحميل الطلبات — حاول مرة أخرى")}
        </p>
      ) : (
        <div className="space-y-6">
          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Handshake className="size-4" />
                طلبات واردة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {incoming.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  لا توجد طلبات اتفاقية إدارة واردة.
                </p>
              ) : (
                incoming.map((a) => (
                  <div key={a.id} className="rounded-md border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{a.owner_name || a.owner_email}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">
                          {a.owner_email}
                        </p>
                      </div>
                      <Badge variant={a.status === "sent" ? "secondary" : "outline"}>
                        {a.status === "sent" ? "بانتظار ردّك" : "عدّلت الشروط — بانتظار المالك"}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {a.units_count} وحدة ·{" "}
                      {a.commission_type === "percent"
                        ? `عمولة ${a.commission_value}%`
                        : `عمولة ${sar(a.commission_value)} ثابتة`}
                      {" · "}
                      {shortDate(a.start_date)} —{" "}
                      {a.end_date ? shortDate(a.end_date) : "بلا انتهاء"}
                      {" · "}فترة إشعار {a.notice_period_days} يوم
                    </p>
                    {a.owner_note ? (
                      <p className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">رسالة المالك: </span>
                        {a.owner_note}
                      </p>
                    ) : null}
                    <RequestUnits units={a.units} />
                    <div className="mt-2 flex flex-wrap gap-1">
                      {a.permissions.length === 0 ? (
                        <Badge variant="outline">عرض فقط</Badge>
                      ) : (
                        a.permissions.map((p) => (
                          <Badge key={p} variant="secondary">
                            {PERMISSION_LABEL[p] ?? p}
                          </Badge>
                        ))
                      )}
                    </div>
                    {a.status === "sent" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={respond.isPending}
                          onClick={() => setDeciding({ agreement: a, decision: "accept" })}
                        >
                          <Check className="size-4" />
                          قبول
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCountering(a)}>
                          تعديل الشروط
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={respond.isPending}
                          onClick={() => setDeciding({ agreement: a, decision: "reject" })}
                        >
                          <X className="size-4" />
                          رفض
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {pendingChanges.length > 0 ? (
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="text-base">طلبات توسيع صلاحيات</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingChanges.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-4"
                  >
                    <div>
                      <p className="text-sm">
                        المالك يطلب توسيع الصلاحية إلى{" "}
                        <span className="font-medium">
                          {PERMISSION_LABEL[r.payload?.permission ?? ""] ?? r.payload?.permission}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(r.management_agreements?.agreement_units ?? [])
                          .map(
                            (au) =>
                              `${au.units?.properties?.name ?? ""} · وحدة ${au.units?.unit_number ?? "—"}`,
                          )
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={decideChange.isPending}
                        onClick={() => decideChange.mutate({ id: r.id, decision: "approve" })}
                      >
                        موافقة
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decideChange.isPending}
                        onClick={() => decideChange.mutate({ id: r.id, decision: "reject" })}
                      >
                        رفض
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4" />
                الاتفاقيات السارية
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {active.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">لا توجد اتفاقيات سارية حاليًا.</p>
              ) : (
                active.map((a) => (
                  <div key={a.id} className="rounded-md border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{a.owner_name || a.owner_email}</p>
                      <Badge>سارية</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {a.units
                        .map((u) => `${u.property_name ?? ""} · وحدة ${u.unit_number}`)
                        .join(" · ") || `${a.units_count} وحدة`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {a.permissions.map((p) => (
                        <Badge key={p} variant="secondary">
                          {PERMISSION_LABEL[p] ?? p}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-3">
                      {a.termination_requested_at ? (
                        <p className="text-xs text-muted-foreground">
                          طلب إنهاء مسجّل (
                          {a.termination_requested_by === "office" ? "منك" : "من المالك"}) — يسري
                          بعد فترة الإشعار.
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
                                `طلب إنهاء الاتفاقية مع ${a.owner_name || a.owner_email}؟ تبقى سارية لفترة الإشعار (${a.notice_period_days} يوم) قبل أن ينقطع وصولكم فعليًا.`,
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
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {rejected.length > 0 ? (
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="text-base">طلبات مرفوضة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rejected.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-4"
                  >
                    <div>
                      <p className="font-medium">{a.owner_name || a.owner_email}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {a.units_count} وحدة
                        {a.office_note ? ` · السبب: ${a.office_note}` : ""}
                      </p>
                    </div>
                    <Badge variant="destructive">مرفوضة</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {deciding ? (
        <DecisionDialog
          agreement={deciding.agreement}
          decision={deciding.decision}
          pending={respond.isPending}
          onClose={() => setDeciding(null)}
          onConfirm={(note) =>
            respond.mutate({ id: deciding.agreement.id, decision: deciding.decision, note })
          }
        />
      ) : null}

      {countering ? (
        <CounterDialog
          agreement={countering}
          onClose={() => setCountering(null)}
          onDone={() => {
            setCountering(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function CounterDialog({
  agreement,
  onClose,
  onDone,
}: {
  agreement: AgreementRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const [commissionValue, setCommissionValue] = useState(String(agreement.commission_value));
  const [noticeDays, setNoticeDays] = useState(String(agreement.notice_period_days));
  const [maintenanceCap, setMaintenanceCap] = useState(
    agreement.maintenance_cap != null ? String(agreement.maintenance_cap) : "",
  );
  const [permissions, setPermissions] = useState<Set<string>>(new Set(agreement.permissions));
  const [note, setNote] = useState("");
  const togglePermission = (p: string) =>
    setPermissions((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const send = useMutation({
    mutationFn: async () => {
      const value = Number(commissionValue || 0);
      if (!Number.isFinite(value) || value <= 0) throw new Error("أدخل قيمة عمولة صحيحة");
      const days = Number(noticeDays || 0);
      if (!Number.isInteger(days) || days < 0)
        throw new Error("فترة الإشعار يجب أن تكون رقمًا صحيحًا");
      // exactOptionalPropertyTypes: _maintenance_cap ماله قيمة تُحذف من الكائن كليًا، لا تُمرَّر
      // undefined صراحةً — RPC الفعلية تتعامل مع غيابها كـ "أبقِ القيمة الحالية" (DEFAULT NULL).
      const cap = maintenanceCap.trim() ? Number(maintenanceCap) : undefined;
      const { error } = await supabase.rpc("office_respond_agreement", {
        _agreement_id: agreement.id,
        _decision: "counter",
        _commission_value: value,
        _notice_period_days: days,
        _permissions: Array.from(permissions),
        ...(cap !== undefined ? { _maintenance_cap: cap } : {}),
        ...(note.trim() ? { _note: note.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُرسل التعديل للمالك للبتّ فيه");
      onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال التعديل")),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">تعديل شروط الاتفاقية</DialogTitle>
          <DialogDescription>
            التعديل يرجع للمالك ({agreement.owner_name || agreement.owner_email}) للبتّ فيه — لا
            تصبح سارية إلا بعد قبوله.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{agreement.commission_type === "percent" ? "النسبة %" : "المبلغ (ريال)"}</Label>
            <Input
              inputMode="decimal"
              value={commissionValue}
              onChange={(e) => setCommissionValue(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>فترة إشعار الإنهاء (يوم)</Label>
            <Input
              inputMode="numeric"
              value={noticeDays}
              onChange={(e) => setNoticeDays(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>سقف صيانة بلا موافقة المالك (اختياري)</Label>
            <Input
              inputMode="decimal"
              value={maintenanceCap}
              onChange={(e) => setMaintenanceCap(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>الصلاحيات المطلوبة</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMISSION_OPTIONS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={permissions.has(p)}
                  onCheckedChange={() => togglePermission(p)}
                />
                {PERMISSION_LABEL[p]}
                {UNENFORCED_PERMISSIONS.has(p) ? (
                  <Badge variant="outline" className="text-xs">
                    قريبًا
                  </Badge>
                ) : null}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>توضيح للمالك (اختياري)</Label>
          <Textarea
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: نسبتنا المعتادة للعمائر 7% وتشمل التحصيل والصيانة الدورية."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? "جارٍ الإرسال..." : "إرسال التعديل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VISIBLE_UNITS = 4;

/** The units of a request with what the office needs to decide: specs, furniture, expected price. */
function RequestUnits({ units }: { units: RequestUnit[] }) {
  const [all, setAll] = useState(false);
  if (units.length === 0) return null;
  const shown = all ? units : units.slice(0, VISIBLE_UNITS);
  return (
    <div className="mt-3 space-y-2">
      {shown.map((u) => {
        const level = isFurnishing(u.furnishing) ? u.furnishing : "none";
        const items = parseFurniture(u.furniture);
        const specs = unitSpecsLine(u);
        const price =
          u.listing_purpose === "sale"
            ? u.sale_price
              ? `${sar(u.sale_price)} للبيع`
              : null
            : u.annual_rent
              ? `${sar(u.annual_rent)} سنويًا (متوقع)`
              : null;
        return (
          <div key={u.unit_id} className="rounded-md border border-border px-3 py-2 text-sm">
            <p className="font-medium">
              {u.property_structure === "single"
                ? `${u.property_name ?? ""} · ${u.unit_type}`
                : `${u.property_name ?? ""} · وحدة ${u.unit_number} · ${u.unit_type}`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[[u.city, u.district].filter(Boolean).join(" · "), specs, price]
                .filter(Boolean)
                .join(" — ")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {FURNISHING_LABEL[level]}
              {level !== "none" && items.length > 0 ? `: ${furnitureSummary(items)}` : ""}
              {u.deed_number ? ` · صك ${u.deed_number}` : ""}
            </p>
          </div>
        );
      })}
      {units.length > VISIBLE_UNITS ? (
        <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
          {all ? "عرض أقل" : `عرض كل الوحدات (${units.length})`}
        </Button>
      ) : null}
    </div>
  );
}

const REJECT_REASONS = [
  "العقار خارج نطاق تغطيتنا",
  "لا نستقبل عقارات جديدة حاليًا",
  "نوع العقار خارج تخصصنا",
  "الشروط المقترحة غير مناسبة",
];

/** قبول أو رفض طلب الإدارة، مع رسالة اختيارية تصل للمالك في إشعاره. */
function DecisionDialog({
  agreement,
  decision,
  pending,
  onClose,
  onConfirm,
}: {
  agreement: AgreementRequest;
  decision: "accept" | "reject";
  pending: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const accept = decision === "accept";
  const owner = agreement.owner_name || agreement.owner_email;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {accept ? "قبول طلب الإدارة" : "الاعتذار عن طلب الإدارة"}
          </DialogTitle>
          <DialogDescription>
            {accept
              ? `تصبح الاتفاقية مع ${owner} سارية فورًا على ${agreement.units_count} وحدة، وتظهر وحداته في «الأملاك والوحدات».`
              : `يصل ${owner} إشعار بالاعتذار، ويستطيع إرسال طلبه لمكتب آخر.`}
          </DialogDescription>
        </DialogHeader>
        {accept ? null : (
          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={note === r}
                onClick={() => setNote(r)}
                className={`border px-3 py-1 text-xs transition-colors ${
                  note === r
                    ? "border-foreground bg-foreground text-background"
                    : "border-input hover:bg-muted"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{accept ? "رسالة ترحيب (اختياري)" : "سبب الاعتذار (اختياري)"}</Label>
          <Textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              accept
                ? "مثال: أهلًا بك، سيتواصل معك مدير العقارات خلال يوم عمل."
                : "يظهر للمالك في إشعار الرد"
            }
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant={accept ? "default" : "outline"}
            className={accept ? undefined : "text-destructive"}
            disabled={pending}
            onClick={() => onConfirm(note)}
          >
            {pending ? "جارٍ الإرسال..." : accept ? "قبول الطلب" : "تأكيد الاعتذار"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
