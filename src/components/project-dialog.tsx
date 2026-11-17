import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { AMENITIES } from "@/lib/amenities";
import { userErrorMessage } from "@/lib/auth-errors";
import { PROJECT_STATUSES, statusLabel, type ProjectStatus } from "@/lib/projects";

/**
 * نافذة المشروع. ترخيص «وافي» وربع التسليم ليسا حقلين تجميليين: القاعدة ترفض نشر مشروع على
 * الخارطة بلا ترخيص، ومشروعًا غير جاهز بلا ربع تسليم (guard_project_publish) — فالنافذة تقول ذلك
 * قبل المحاولة.
 */

export type ProjectFormRow = {
  id: string;
  name: string;
  developer_name: string | null;
  city: string | null;
  district: string | null;
  status: string;
  completion_pct: number;
  delivery_year: number | null;
  delivery_quarter: number | null;
  wafi_license_no: string | null;
  total_units: number | null;
  description: string | null;
  amenities: string[];
  published: boolean;
};

const YEARS = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() + i);
const QUARTERS = [1, 2, 3, 4];

type Form = {
  name: string;
  developer_name: string;
  city: string;
  district: string;
  status: ProjectStatus;
  completion_pct: string;
  delivery_year: string;
  delivery_quarter: string;
  wafi_license_no: string;
  total_units: string;
  description: string;
  amenities: string[];
};

const empty: Form = {
  name: "",
  developer_name: "",
  city: "",
  district: "",
  status: "off_plan",
  completion_pct: "0",
  delivery_year: "",
  delivery_quarter: "",
  wafi_license_no: "",
  total_units: "",
  description: "",
  amenities: [],
};

function fromRow(p: ProjectFormRow): Form {
  return {
    name: p.name,
    developer_name: p.developer_name ?? "",
    city: p.city ?? "",
    district: p.district ?? "",
    status: (PROJECT_STATUSES as readonly string[]).includes(p.status)
      ? (p.status as ProjectStatus)
      : "off_plan",
    completion_pct: String(p.completion_pct ?? 0),
    delivery_year: p.delivery_year ? String(p.delivery_year) : "",
    delivery_quarter: p.delivery_quarter ? String(p.delivery_quarter) : "",
    wafi_license_no: p.wafi_license_no ?? "",
    total_units: p.total_units ? String(p.total_units) : "",
    description: p.description ?? "",
    amenities: p.amenities ?? [],
  };
}

export function ProjectDialog({
  open,
  project,
  orgId,
  onClose,
}: {
  open: boolean;
  /** null = مشروع جديد. */
  project: ProjectFormRow | null;
  orgId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(empty);
  const isEdit = project !== null;

  useEffect(() => {
    if (open) setForm(project ? fromRow(project) : empty);
  }, [open, project]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const num = (v: string) => {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        name: form.name.trim(),
        developer_name: form.developer_name.trim() || null,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
        status: form.status,
        completion_pct: Math.max(0, Math.min(100, Number(form.completion_pct) || 0)),
        delivery_year: form.delivery_year ? Number(form.delivery_year) : null,
        delivery_quarter: form.delivery_quarter ? Number(form.delivery_quarter) : null,
        wafi_license_no: form.wafi_license_no.trim() || null,
        total_units: num(form.total_units),
        description: form.description.trim() || null,
        amenities: form.amenities,
      };
      if (isEdit) {
        const { error } = await supabase.from("projects").update(row).eq("id", project.id);
        if (error) throw error;
      } else {
        if (!orgId) throw new Error("لم نتعرّف على مكتبك — أعد تحميل الصفحة");
        const { error } = await supabase.from("projects").insert({ ...row, org_id: orgId });
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success(isEdit ? "حُفظ المشروع" : "أُنشئ المشروع — أضف نماذج وحداته ثم انشره");
      await queryClient.invalidateQueries({ queryKey: ["office-projects"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حفظ المشروع")),
  });

  const needsWafi = form.status === "off_plan" && !form.wafi_license_no.trim();
  const needsDelivery = form.status !== "ready" && (!form.delivery_year || !form.delivery_quarter);
  const valid = form.name.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل المشروع" : "مشروع جديد"}</DialogTitle>
          <DialogDescription>
            المشروع مجمّع أو برج له نماذج وحدات — لا وحدة واحدة. يُحفظ ناقصًا ويُكمَل على مراحل، ولا
            يُنشر إلا بنموذج واحد على الأقل.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المشروع" className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={120}
              placeholder="مثال: مجمع الياسمين السكني"
            />
          </Field>

          <Field label="المطوّر العقاري">
            <Input
              value={form.developer_name}
              onChange={(e) => set("developer_name", e.target.value)}
              maxLength={120}
              placeholder="اسم شركة التطوير"
            />
          </Field>

          <Field label="المرحلة">
            <Select value={form.status} onValueChange={(v) => set("status", v as ProjectStatus)}>
              <SelectTrigger aria-label="المرحلة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="المدينة">
            <Input
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              maxLength={80}
              placeholder="الرياض"
            />
          </Field>

          <Field label="الحي">
            <Input
              value={form.district}
              onChange={(e) => set("district", e.target.value)}
              maxLength={80}
              placeholder="الياسمين"
            />
          </Field>

          {form.status !== "ready" ? (
            <>
              <Field label="نسبة الإنجاز (%)">
                <Input
                  value={form.completion_pct}
                  onChange={(e) => set("completion_pct", e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  maxLength={3}
                />
              </Field>

              <Field label="ربع التسليم المتوقّع">
                <div className="flex gap-2">
                  <Select
                    value={form.delivery_quarter || "none"}
                    onValueChange={(v) => set("delivery_quarter", v === "none" ? "" : v)}
                  >
                    <SelectTrigger aria-label="الربع">
                      <SelectValue placeholder="الربع" />
                    </SelectTrigger>
                    <SelectContent>
                      {QUARTERS.map((q) => (
                        <SelectItem key={q} value={String(q)}>
                          {`الربع ${["الأول", "الثاني", "الثالث", "الرابع"][q - 1]}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={form.delivery_year || "none"}
                    onValueChange={(v) => set("delivery_year", v === "none" ? "" : v)}
                  >
                    <SelectTrigger aria-label="السنة">
                      <SelectValue placeholder="السنة" />
                    </SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Field>
            </>
          ) : null}

          <Field label="رقم ترخيص «وافي»">
            <Input
              value={form.wafi_license_no}
              onChange={(e) => set("wafi_license_no", e.target.value)}
              dir="ltr"
              maxLength={40}
              placeholder="7200000000"
            />
          </Field>

          <Field label="إجمالي الوحدات">
            <Input
              value={form.total_units}
              onChange={(e) => set("total_units", e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              maxLength={6}
            />
          </Field>

          <Field label="وصف المشروع (يظهر للعموم)" className="sm:col-span-2">
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="موقع المشروع، مرافقه، ما يميّزه…"
            />
          </Field>

          <Field label="مزايا المشروع" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {AMENITIES.map((a) => {
                const on = form.amenities.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set(
                        "amenities",
                        on ? form.amenities.filter((x) => x !== a) : [...form.amenities, a],
                      )
                    }
                    className={`border px-3 py-1 text-xs transition-colors ${
                      on
                        ? "border-foreground bg-foreground text-background"
                        : "border-input hover:bg-muted"
                    }`}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        {/* شروط النشر تُقال هنا، لا كرسالة خطأ بعد الضغط على «نشر». */}
        {needsWafi || needsDelivery ? (
          <ul className="flex flex-col gap-1 rounded-sm border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
            {needsWafi ? (
              <li>
                البيع على الخارطة يتطلب رقم ترخيص «وافي» قبل النشر (نظام الهيئة العامة للعقار).
              </li>
            ) : null}
            {needsDelivery ? <li>مشروع غير جاهز يحتاج ربع التسليم المتوقّع قبل النشر.</li> : null}
          </ul>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ…" : isEdit ? "حفظ" : "إنشاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}
