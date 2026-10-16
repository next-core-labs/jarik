import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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

/** تسجيل عقار جديد للمكتب؛ الوحدات تضاف بعده من بطاقة العقار. */
export function PropertyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof empty, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) setForm(empty);
  }, [open]);

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
      // org_id is filled from the signed-in staff member's office (a_fill_org trigger).
      const { error } = await supabase.from("properties").insert({
        name: form.name.trim(),
        property_type: form.property_type,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
        address: form.address.trim() || null,
        deed_number: form.deed_number.trim() || null,
        owner_name: form.owner_name.trim() || null,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل العقار — أضف وحداته الآن");
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر حفظ العقار"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">تسجيل عقار جديد</DialogTitle>
          <DialogDescription>
            عمارة أو فيلا أو مجمع؛ بعد الحفظ أضف وحداته واختر عرضها في سوق العروض.
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
            حفظ العقار
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
