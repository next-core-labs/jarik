import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  PERMISSION_LABEL,
  PERMISSION_OPTIONS,
  UNENFORCED_PERMISSIONS,
} from "@/lib/agreement-permissions";
import { todayRiyadh } from "@/lib/dates";
import { toLatinDigits } from "@/lib/saudi-id";

/** A number typed on either keyboard: Arabic-Indic digits, "٫" as the decimal point, and "٬" or ","
 * as thousands separators. Anything else gives NaN, so "abc" is rejected instead of becoming null. */
function parseAmount(raw: string): number {
  const s = toLatinDigits(raw.trim()).replace(/٫/g, ".").replace(/[٬,]/g, "");
  return s === "" ? NaN : Number(s);
}

export type PropertyWithUnits = {
  id: string;
  name: string;
  city?: string | null;
  district?: string | null;
  units: { id: string; unit_number: string; unit_type: string; status: string }[] | null;
};

type NearbyOffice = {
  id: string;
  company_name: string;
  fal_license_no: string | null;
  city: string | null;
  district: string | null;
  distance_km: number | null;
  same_city: boolean;
  same_district: boolean;
};

/**
 * طلب اتفاقية إدارة: اختر وحداتك ← مكتبًا قريبًا منها ← الشروط. The office is notified and accepts,
 * adjusts the terms or declines (office_respond_agreement); the owner is notified of its answer.
 */
export function RequestAgreementDialog({
  properties,
  excludedUnitIds,
  initialUnitIds,
  onClose,
  onDone,
}: {
  properties: PropertyWithUnits[];
  excludedUnitIds: Set<string>;
  /** Opened from a property: its units are already chosen, so it starts at the office step. */
  initialUnitIds?: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const preselected = (initialUnitIds ?? []).filter((id) => !excludedUnitIds.has(id));
  const [step, setStep] = useState<"units" | "office" | "terms">(
    preselected.length > 0 ? "office" : "units",
  );
  const [officeQuery, setOfficeQuery] = useState("");
  const [selectedOffice, setSelectedOffice] = useState<NearbyOffice | null>(null);
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set(preselected));
  const [commissionType, setCommissionType] = useState<"percent" | "fixed">("percent");
  const [commissionValue, setCommissionValue] = useState("5");
  const [startDate, setStartDate] = useState(() => todayRiyadh());
  const [endDate, setEndDate] = useState("");
  const [noticeDays, setNoticeDays] = useState("30");
  const [maintenanceCap, setMaintenanceCap] = useState("");
  const [permissions, setPermissions] = useState<Set<string>>(new Set(["leasing", "maintenance"]));
  const [note, setNote] = useState("");

  // The offices are ranked around the property of the chosen units (the first one with a pin).
  const chosenPropertyIds = useMemo(
    () =>
      properties
        .filter((p) => (p.units ?? []).some((u) => selectedUnits.has(u.id)))
        .map((p) => p.id),
    [properties, selectedUnits],
  );
  const anchor = properties.find((p) => p.id === chosenPropertyIds[0]) ?? null;
  const pins = useQuery({
    queryKey: ["owner-property-pins", chosenPropertyIds],
    enabled: step !== "units" && chosenPropertyIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, lat, lng, city, district")
        .in("id", chosenPropertyIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const pin = (pins.data ?? []).find((p) => p.lat != null && p.lng != null) ?? null;
  const near = {
    lat: pin?.lat ?? null,
    lng: pin?.lng ?? null,
    city: pin?.city ?? anchor?.city ?? null,
    district: pin?.district ?? anchor?.district ?? null,
  };

  const offices = useQuery({
    queryKey: ["offices-near", near.lat, near.lng, near.city, near.district],
    enabled: step === "office" && !pins.isLoading,
    queryFn: async (): Promise<NearbyOffice[]> => {
      const { data, error } = await supabase.rpc("offices_near", {
        ...(near.lat != null && near.lng != null ? { _lat: near.lat, _lng: near.lng } : {}),
        ...(near.city ? { _city: near.city } : {}),
        ...(near.district ? { _district: near.district } : {}),
      });
      if (error) throw error;
      return (data ?? []) as NearbyOffice[];
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
      const value = parseAmount(commissionValue || "0");
      if (!Number.isFinite(value) || value <= 0) throw new Error("أدخل قيمة عمولة صحيحة");
      if (commissionType === "percent" && value > 100)
        throw new Error("نسبة العمولة لا تتجاوز ١٠٠٪");
      if (!startDate) throw new Error("اختر تاريخ البدء");
      if (endDate && endDate <= startDate)
        throw new Error("تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء");
      const days = parseAmount(noticeDays || "30");
      if (!Number.isInteger(days) || days < 0)
        throw new Error("فترة الإشعار يجب أن تكون رقمًا صحيحًا");
      const cap = maintenanceCap.trim() ? parseAmount(maintenanceCap) : null;
      if (cap !== null && (!Number.isFinite(cap) || cap < 0))
        throw new Error("سقف الصيانة يجب أن يكون مبلغًا بالأرقام، أو اتركه فارغًا");
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
        ...(note.trim() ? { _note: note.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        `أُرسل الطلب إلى ${selectedOffice?.company_name ?? "المكتب"} — يصلك إشعار عند قبوله أو رفضه`,
      );
      onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الطلب")),
  });

  const description =
    step === "units"
      ? "اختر الوحدات التي تريد أن يديرها المكتب."
      : step === "office"
        ? `${selectedUnits.size} وحدة — اختر مكتبًا؛ الأقرب لعقارك أولًا.`
        : `${selectedOffice?.company_name ?? ""} — حدّد الشروط والصلاحيات.`;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">طلب اتفاقية إدارة</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step === "units" ? (
          <div className="space-y-3">
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border p-3">
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
                    {(p.units ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        لا وحدات مسجّلة في هذا العقار.
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
              {properties.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  ما عندك وحدات مسجّلة بعد — أضفها من «عقاراتي» أولًا.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                إلغاء
              </Button>
              <Button disabled={selectedUnits.size === 0} onClick={() => setStep("office")}>
                التالي: اختيار المكتب
              </Button>
            </DialogFooter>
          </div>
        ) : step === "office" ? (
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
            {near.lat == null && !pins.isLoading ? (
              <p className="text-xs text-muted-foreground">
                حدّد موقع عقارك على الخريطة (من «عقاراتي») لترتيب المكاتب حسب المسافة.
              </p>
            ) : null}
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {offices.isLoading || pins.isLoading ? (
                <Skeleton className="h-16" />
              ) : offices.error ? (
                <p className="text-destructive">
                  {userErrorMessage(offices.error, "تعذّر تحميل المكاتب — حاول مرة أخرى")}
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
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{o.company_name}</p>
                      <div className="flex flex-wrap gap-1">
                        {o.same_district ? (
                          <Badge variant="secondary">في حيّ عقارك</Badge>
                        ) : o.same_city ? (
                          <Badge variant="outline">في مدينتك</Badge>
                        ) : null}
                        {o.distance_km != null ? (
                          <Badge variant="outline" className="gap-1">
                            <MapPin className="size-3" />
                            {o.distance_km < 1 ? "أقل من ١ كم" : `${o.distance_km} كم`}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[o.city, o.district].filter(Boolean).join(" · ") || "غير محدّد"}
                      {o.fal_license_no ? ` · فال ${o.fal_license_no}` : ""}
                    </p>
                  </button>
                ))
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("units")}>
                رجوع
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
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

            <div className="space-y-1.5">
              <Label>رسالة للمكتب (اختياري)</Label>
              <Textarea
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="مثال: العمارة جديدة وأبحث عن مكتب يتولى التأجير والتحصيل والصيانة."
              />
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
