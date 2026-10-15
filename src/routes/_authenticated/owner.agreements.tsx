import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Handshake, Search } from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PERMISSION_LABEL,
  PERMISSION_OPTIONS,
  UNENFORCED_PERMISSIONS,
} from "@/lib/agreement-permissions";
import { sar, shortDate } from "@/lib/format";

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
};
const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  sent: "secondary",
  office_modified: "secondary",
  active: "default",
  rejected: "destructive",
  cancelled: "outline",
};

type Office = {
  id: string;
  company_name: string;
  fal_license_no: string | null;
  office_phone: string | null;
  city: string | null;
  district: string | null;
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
  agreement_units: {
    unit_id: string;
    units: { unit_number: string; properties: { name: string } | null } | null;
  }[];
  agreement_permissions: { permission: string }[];
};

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
          "id, status, commission_type, commission_value, start_date, end_date, notice_period_days, maintenance_cap, termination_requested_at, termination_requested_by, org_id, agreement_units(unit_id, units(unit_number, properties(name))), agreement_permissions(permission)",
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

  // owner_units(), not properties→units: same ownership rule as request_management_agreement
  // (the unit's own owner, else the property's), so an owner of a single unit inside someone
  // else's property can still pick it — properties RLS hides that property from them.
  const properties = useQuery({
    queryKey: ["owner-agreements-properties"],
    queryFn: async (): Promise<PropertyWithUnits[]> => {
      const { data, error } = await supabase.rpc("owner_units");
      if (error) throw error;
      const byProperty = new Map<
        string,
        PropertyWithUnits & { units: NonNullable<PropertyWithUnits["units"]> }
      >();
      for (const u of data ?? []) {
        const p = byProperty.get(u.property_id) ?? {
          id: u.property_id,
          name: u.property_name,
          units: [],
        };
        p.units.push({
          id: u.unit_id,
          unit_number: u.unit_number,
          unit_type: u.unit_type,
          status: u.status,
        });
        byProperty.set(u.property_id, p);
      }
      return [...byProperty.values()];
    },
  });

  // وحدة عليها اتفاقية سارية فعلاً (أو منتهية بفترة إشعار لسه ما خلصت) تُستبعد من اختيار طلب جديد —
  // نفس شرط request_management_agreement بالضبط (status='active' AND (بلا طلب إنهاء، أو فترة
  // الإشعار ما خلصت بعد)): status تبقى 'active' حتى بعد ما تنتهي فترة الإشعار فعليًا (تُحسب حيّة،
  // لا عمود منفصل) — فحص status وحده بدون هذا الشرط يُبقي الوحدة مستبعدة للأبد حتى بعد ما يقبل
  // الخادم فعليًا طلبًا جديدًا عليها.
  const unitsUnderActiveAgreement = useMemo(() => {
    const s = new Set<string>();
    const now = Date.now();
    for (const a of agreements.data ?? []) {
      if (a.status !== "active") continue;
      if (
        a.termination_requested_at &&
        now >= new Date(a.termination_requested_at).getTime() + a.notice_period_days * 86400000
      ) {
        continue;
      }
      for (const au of a.agreement_units) s.add(au.unit_id);
    }
    return s;
  }, [agreements.data]);

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
    onError: (e: Error) => toast.error(e.message || "تعذّر تسجيل طلب الإنهاء"),
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
    onError: (e: Error) => toast.error(e.message || "تعذّر تسجيل القرار"),
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
          تعذّر التحميل: {((agreements.error ?? properties.error) as Error).message}
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
            list.map((a) => (
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
                    <Badge variant={STATUS_BADGE_VARIANT[a.status] ?? "outline"}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {shortDate(a.start_date)} —{" "}
                    {a.end_date ? shortDate(a.end_date) : "بلا تاريخ انتهاء"}
                    {" · "}فترة إشعار الإنهاء {a.notice_period_days} يوم
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
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                    {a.agreement_units.map((au) => (
                      <span key={au.unit_id} className="rounded-md border border-border px-2 py-1">
                        {au.units?.properties?.name ?? ""} · وحدة {au.units?.unit_number ?? "—"}
                      </span>
                    ))}
                  </div>

                  {a.status === "office_modified" ? (
                    <div className="flex flex-wrap gap-2 pt-2">
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
                    </div>
                  ) : null}

                  {a.status === "active" ? (
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingPerms(a)}>
                        تعديل الصلاحيات
                      </Button>
                      {a.termination_requested_at ? (
                        <p className="flex items-center text-xs text-muted-foreground">
                          طلب إنهاء مسجّل (
                          {a.termination_requested_by === "owner" ? "منك" : "من المكتب"}) — يسري بعد
                          فترة الإشعار.
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
                                `طلب إنهاء الاتفاقية مع ${officeNames.data?.[a.org_id] ?? "المكتب"}؟ تبقى سارية لفترة الإشعار (${a.notice_period_days} يوم) قبل أن ينقطع الوصول فعليًا.`,
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
            ))
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

type PropertyWithUnits = {
  id: string;
  name: string;
  units: { id: string; unit_number: string; unit_type: string; status: string }[] | null;
};

function RequestAgreementDialog({
  properties,
  excludedUnitIds,
  onClose,
  onDone,
}: {
  properties: PropertyWithUnits[];
  excludedUnitIds: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"office" | "terms">("office");
  const [officeQuery, setOfficeQuery] = useState("");
  const [selectedOffice, setSelectedOffice] = useState<Office | null>(null);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
  const [commissionType, setCommissionType] = useState<"percent" | "fixed">("percent");
  const [commissionValue, setCommissionValue] = useState("5");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [noticeDays, setNoticeDays] = useState("30");
  const [maintenanceCap, setMaintenanceCap] = useState("");
  const [permissions, setPermissions] = useState<Set<string>>(new Set(["leasing", "maintenance"]));

  const offices = useQuery({
    queryKey: ["owner-agreements-offices"],
    queryFn: async (): Promise<Office[]> => {
      const { data, error } = await supabase
        .from("office_directory")
        .select("id, company_name, fal_license_no, office_phone, city, district");
      if (error) throw error;
      return (data ?? []) as Office[];
    },
  });

  const term = officeQuery.trim();
  const officeList = (offices.data ?? []).filter(
    (o) =>
      !term ||
      o.company_name.includes(term) ||
      (o.city ?? "").includes(term) ||
      (o.district ?? "").includes(term),
  );

  const toggleUnit = (id: string) =>
    setSelectedUnits((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePermission = (p: string) =>
    setPermissions((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const send = useMutation({
    mutationFn: async () => {
      if (!selectedOffice) throw new Error("اختر مكتبًا أولًا");
      if (selectedUnits.size === 0) throw new Error("اختر وحدة واحدة على الأقل");
      const value = Number(commissionValue || 0);
      if (!Number.isFinite(value) || value <= 0) throw new Error("أدخل قيمة عمولة صحيحة");
      const days = Number(noticeDays || 30);
      if (!Number.isInteger(days) || days < 0)
        throw new Error("فترة الإشعار يجب أن تكون رقمًا صحيحًا");
      const cap = maintenanceCap.trim() ? Number(maintenanceCap) : null;
      const { error } = await supabase.rpc("request_management_agreement", {
        _org_id: selectedOffice.id,
        _unit_ids: Array.from(selectedUnits),
        _commission_type: commissionType,
        _commission_value: value,
        _start_date: startDate,
        _end_date: (endDate || null) as unknown as string,
        _notice_period_days: days,
        _maintenance_cap: cap as unknown as number,
        _permissions: Array.from(permissions),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُرسل طلب الاتفاقية للمكتب — يصلك إشعار عند رده");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال الطلب"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">طلب اتفاقية إدارة</DialogTitle>
          <DialogDescription>
            {step === "office"
              ? "اختر المكتب الذي تريده أن يدير وحداتك."
              : `${selectedOffice?.company_name ?? ""} — حدد الوحدات والشروط.`}
          </DialogDescription>
        </DialogHeader>

        {step === "office" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pe-9"
                placeholder="ابحث باسم المكتب أو المدينة أو الحي"
                value={officeQuery}
                onChange={(e) => setOfficeQuery(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {offices.isLoading ? (
                <Skeleton className="h-16" />
              ) : offices.error ? (
                <p className="text-destructive">
                  تعذّر تحميل المكاتب: {(offices.error as Error).message}
                </p>
              ) : officeList.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  لا توجد مكاتب مطابقة.
                </p>
              ) : (
                officeList.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="w-full rounded-md border border-border p-3 text-start hover:bg-muted/50"
                    onClick={() => {
                      setSelectedOffice(o);
                      setStep("terms");
                    }}
                  >
                    <p className="font-medium">{o.company_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[o.city, o.district].filter(Boolean).join(" · ") || "غير محدّد"}
                      {o.fal_license_no ? ` · فال ${o.fal_license_no}` : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                إلغاء
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>الوحدات المشمولة</Label>
              <div className="max-h-48 space-y-3 overflow-y-auto rounded-md border border-border p-3">
                {properties.map((p) => (
                  <div key={p.id}>
                    <p className="text-sm font-medium">{p.name}</p>
                    <div className="mt-1 space-y-1 ps-2">
                      {(p.units ?? []).map((u) => {
                        const disabled = excludedUnitIds.has(u.id);
                        return (
                          <label
                            key={u.id}
                            className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}
                          >
                            <Checkbox
                              checked={selectedUnits.has(u.id)}
                              disabled={disabled}
                              onCheckedChange={() => toggleUnit(u.id)}
                            />
                            وحدة {u.unit_number} ({u.unit_type})
                            {disabled ? " — لها اتفاقية سارية بالفعل" : ""}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {properties.length === 0 ? (
                  <p className="text-sm text-muted-foreground">ما عندك عقارات مسجّلة بعد.</p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>نوع العمولة</Label>
                <Select
                  value={commissionType}
                  onValueChange={(v) => setCommissionType(v as "percent" | "fixed")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">نسبة مئوية</SelectItem>
                    <SelectItem value="fixed">مبلغ ثابت</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{commissionType === "percent" ? "النسبة %" : "المبلغ (ريال)"}</Label>
                <Input
                  inputMode="decimal"
                  value={commissionValue}
                  onChange={(e) => setCommissionValue(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>تاريخ البدء</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>تاريخ الانتهاء (اختياري)</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>فترة إشعار الإنهاء (يوم)</Label>
                <Input
                  inputMode="numeric"
                  value={noticeDays}
                  onChange={(e) => setNoticeDays(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>سقف صيانة بلا موافقتك (اختياري)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="يستخدم سقف المكتب الافتراضي إن تُرك فارغًا"
                  value={maintenanceCap}
                  onChange={(e) => setMaintenanceCap(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>الصلاحيات الممنوحة للمكتب</Label>
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
              <p className="text-xs text-muted-foreground">
                عرض بيانات وحداتك متاح للمكتب دائمًا طالما الاتفاقية سارية، بصرف النظر عن الصلاحيات
                المحددة هنا.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("office")}>
                رجوع
              </Button>
              <Button
                disabled={send.isPending || selectedUnits.size === 0}
                onClick={() => send.mutate()}
              >
                {send.isPending ? "جارٍ الإرسال..." : "إرسال الطلب"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  const [permissions, setPermissions] = useState<Set<string>>(
    new Set(agreement.agreement_permissions.map((p) => p.permission)),
  );
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
    onError: (e: Error) => toast.error(e.message || "تعذّر الحفظ"),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">تعديل الصلاحيات</DialogTitle>
          <DialogDescription>
            {officeName} — تقليص الصلاحيات فوري، وتوسيعها يحتاج موافقة المكتب.
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
