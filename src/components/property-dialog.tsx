import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
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
import { isInSaudi, parseLocation } from "@/lib/location-input";
import { PROPERTY_TYPE_GROUPS } from "@/lib/property-types";

const empty = {
  name: "",
  property_type: "سكني",
  city: "",
  district: "",
  address: "",
  deed_number: "",
  owner_name: "",
  location: "",
};

/** The saved property being edited; its fields prefill the form. */
export type EditableProperty = {
  id: string;
  name: string;
  property_type: string;
  city: string | null;
  district: string | null;
  address: string | null;
  deed_number: string | null;
  owner_name: string | null;
  lat: number | null;
  lng: number | null;
};

function formFrom(p: EditableProperty): typeof empty {
  return {
    name: p.name,
    property_type: p.property_type,
    city: p.city ?? "",
    district: p.district ?? "",
    address: p.address ?? "",
    deed_number: p.deed_number ?? "",
    owner_name: p.owner_name ?? "",
    location: p.lat != null && p.lng != null ? `${p.lat}, ${p.lng}` : "",
  };
}

/** تسجيل عقار جديد للمكتب (الوحدات تضاف بعده من بطاقة العقار)، أو تعديل عقار مسجّل. */
export function PropertyDialog({
  open,
  onOpenChange,
  property,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  property?: EditableProperty | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(property);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof empty, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) setForm(property ? formFrom(property) : empty);
  }, [open, property]);

  const location = form.location.trim() ? parseLocation(form.location) : null;
  const locationError = !form.location.trim()
    ? null
    : !location
      ? "الصق الإحداثيات (24.81, 46.61) أو رابط خرائط جوجل الكامل — الروابط المختصرة لا تحمل الموقع"
      : !isInSaudi(location)
        ? "الموقع خارج المملكة — تأكد من ترتيب خط العرض ثم خط الطول"
        : null;

  const save = useMutation({
    mutationFn: async () => {
      const values = {
        name: form.name.trim(),
        property_type: form.property_type,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
        address: form.address.trim() || null,
        deed_number: form.deed_number.trim() || null,
        owner_name: form.owner_name.trim() || null,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
      };
      // org_id is filled from the signed-in staff member's office (a_fill_org trigger).
      const { error } = property
        ? await supabase.from("properties").update(values).eq("id", property.id)
        : await supabase.from("properties").insert(values);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isEdit ? "تم تحديث بيانات العقار" : "تم تسجيل العقار — أضف وحداته الآن");
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حفظ العقار")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isEdit ? "تعديل بيانات العقار" : "تسجيل عقار جديد"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? property?.name
              : "عمارة أو فيلا أو مجمع؛ بعد الحفظ أضف وحداته واختر عرضها في سوق العروض."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="اسم العقار">
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="مثال: عمارة الملقا ٣"
              />
            </Field>
          </div>
          <Field label="التصنيف">
            <Select value={form.property_type} onValueChange={(v) => set("property_type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPE_GROUPS.map((g) => (
                  <SelectItem key={g.group} value={g.group}>
                    {g.group}
                  </SelectItem>
                ))}
                {/* A property saved before this list existed may carry its own wording. */}
                {PROPERTY_TYPE_GROUPS.some((g) => g.group === form.property_type) ? null : (
                  <SelectItem value={form.property_type}>{form.property_type}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="المدينة">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="الحي">
            <Input value={form.district} onChange={(e) => set("district", e.target.value)} />
          </Field>
          <Field label="العنوان / الشارع">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="رقم الصك">
            <Input
              dir="ltr"
              value={form.deed_number}
              onChange={(e) => set("deed_number", e.target.value)}
            />
          </Field>
          <Field label="اسم المالك">
            <Input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="الموقع على الخريطة (يظهر تقريبيًا للعموم)">
              <Input
                dir="ltr"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="24.8073, 46.6129  أو  https://www.google.com/maps/…"
                aria-invalid={Boolean(locationError)}
              />
              <p
                className={`text-xs ${locationError ? "text-destructive" : "text-muted-foreground"}`}
              >
                {locationError ??
                  "بدون موقع لن تظهر الوحدات على الخريطة. يمكنك تحديده لاحقًا من صفحة الخريطة."}
              </p>
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.name.trim() || Boolean(locationError) || save.isPending}
          >
            {isEdit ? "حفظ التعديلات" : "حفظ العقار"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
