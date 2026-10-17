import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Home } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isInSaudi, parseLocation } from "@/lib/location-input";
import { parseAmount } from "@/lib/public-form";
import {
  BUILDING_TYPES,
  PROPERTY_TYPE_GROUPS,
  SINGLE_UNIT_TYPE_GROUPS,
  groupOfType,
  type PropertyStructure,
} from "@/lib/property-types";

const empty = {
  structure: "single" as PropertyStructure,
  name: "",
  property_type: "سكني",
  building_type: BUILDING_TYPES[0]!,
  unit_type: "شقة",
  city: "",
  district: "",
  address: "",
  deed_number: "",
  owner_name: "",
  location: "",
  floors_count: "",
  year_built: "",
  elevators: "",
  parking_spaces: "",
};
type Form = typeof empty;

/** The saved property being edited; its fields prefill the form. */
export type EditableProperty = {
  id: string;
  name: string;
  property_type: string;
  structure: string;
  building_type: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  deed_number: string | null;
  owner_name: string | null;
  lat: number | null;
  lng: number | null;
  floors_count: number | null;
  year_built: number | null;
  elevators: number | null;
  parking_spaces: number | null;
};

/** What the screen needs to continue straight into the new property's units. */
export type CreatedProperty = {
  id: string;
  name: string;
  structure: PropertyStructure;
  district: string;
  deed_number: string;
  unit_type: string;
  floors_count: number | null;
};

const num = (v: number | null) => (v == null ? "" : String(v));

function formFrom(p: EditableProperty): Form {
  return {
    ...empty,
    structure: p.structure === "single" ? "single" : "building",
    name: p.name,
    property_type: p.property_type,
    building_type: p.building_type ?? BUILDING_TYPES[0]!,
    city: p.city ?? "",
    district: p.district ?? "",
    address: p.address ?? "",
    deed_number: p.deed_number ?? "",
    owner_name: p.owner_name ?? "",
    location: p.lat != null && p.lng != null ? `${p.lat}, ${p.lng}` : "",
    floors_count: num(p.floors_count),
    year_built: num(p.year_built),
    elevators: num(p.elevators),
    parking_spaces: num(p.parking_spaces),
  };
}

/** A whole number in [min, max] typed on either keyboard; undefined when empty, null when invalid. */
function wholeIn(v: string, min: number, max: number): number | null | undefined {
  const n = parseAmount(v);
  if (n === undefined || n === null) return n;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * تسجيل عقار: وحدة مستقلة (شقة، فيلا، دور…) أو عمارة/برج بعدة وحدات — للمكتب أو للمالك نفسه.
 *
 * A new single unit continues straight into its unit form, a new building into adding its
 * apartments (onCreated). An owner's property belongs to the owner and to no office until a
 * management agreement is accepted (owner_id = the owner, org_id stays empty).
 */
export function PropertyDialog({
  open,
  onOpenChange,
  property,
  mode = "office",
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  property?: EditableProperty | null;
  mode?: "office" | "owner";
  onCreated?: (p: CreatedProperty) => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(property);
  const isOwner = mode === "owner";
  const [form, setForm] = useState<Form>(empty);
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) setForm(property ? formFrom(property) : empty);
  }, [open, property]);

  const single = form.structure === "single";
  const location = form.location.trim() ? parseLocation(form.location) : null;
  const locationError = !form.location.trim()
    ? null
    : !location
      ? "الصق الإحداثيات (24.81, 46.61) أو رابط خرائط جوجل الكامل — الروابط المختصرة لا تحمل الموقع"
      : !isInSaudi(location)
        ? "الموقع خارج المملكة — تأكد من ترتيب خط العرض ثم خط الطول"
        : null;

  const floors = wholeIn(form.floors_count, 0, 300);
  const yearBuilt = wholeIn(form.year_built, 1900, 2100);
  const elevators = wholeIn(form.elevators, 0, 100);
  const parking = wholeIn(form.parking_spaces, 0, 10000);
  const errors = {
    floors_count: floors === null ? "عدد الأدوار رقم صحيح" : null,
    year_built: yearBuilt === null ? "سنة البناء بالميلادي، مثل 2018" : null,
    elevators: elevators === null ? "عدد المصاعد رقم صحيح" : null,
    parking_spaces: parking === null ? "عدد المواقف رقم صحيح" : null,
  };
  const formError = locationError ?? Object.values(errors).find((e) => e !== null) ?? null;

  const save = useMutation({
    mutationFn: async (): Promise<CreatedProperty | null> => {
      if (formError) throw new Error(formError);
      const values = {
        name: form.name.trim(),
        structure: form.structure,
        // The broad class follows the chosen unit/building type unless the office set its own.
        property_type: single
          ? groupOfType(form.unit_type)
          : isEdit
            ? form.property_type
            : groupOfType(form.building_type),
        building_type: single ? null : form.building_type,
        city: form.city.trim() || null,
        district: form.district.trim() || null,
        address: form.address.trim() || null,
        deed_number: form.deed_number.trim() || null,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        floors_count: floors ?? null,
        year_built: yearBuilt ?? null,
        elevators: single ? null : (elevators ?? null),
        parking_spaces: parking ?? null,
        ...(isOwner ? {} : { owner_name: form.owner_name.trim() || null }),
      };
      if (property) {
        const { error } = await supabase.from("properties").update(values).eq("id", property.id);
        if (error) throw error;
        return null;
      }
      // An office's property gets its org_id from the staff member's office (a_fill_org trigger);
      // an owner's stays office-less and is theirs.
      // The owner's name rides along so the office that later manages it sees who owns it.
      let ownerFields: { owner_id: string; owner_name: string | null } | null = null;
      if (isOwner) {
        const { data } = await supabase.auth.getUser();
        if (!data.user) throw new Error("سجّل دخولك أولًا");
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", data.user.id)
          .maybeSingle();
        ownerFields = { owner_id: data.user.id, owner_name: profile?.full_name?.trim() || null };
      }
      const { data, error } = await supabase
        .from("properties")
        .insert({ ...values, ...(ownerFields ?? {}) })
        .select("id")
        .single();
      if (error) throw error;
      return {
        id: data.id,
        name: values.name,
        structure: form.structure,
        district: form.district.trim(),
        deed_number: form.deed_number.trim(),
        unit_type: form.unit_type,
        floors_count: floors ?? null,
      };
    },
    onSuccess: (created) => {
      toast.success(
        isEdit
          ? "تم تحديث بيانات العقار"
          : single
            ? "تم تسجيل العقار — أكمل مواصفات الوحدة"
            : "تم تسجيل العقار — أضف وحداته الآن",
      );
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      queryClient.invalidateQueries({ queryKey: ["owner-own-properties"] });
      queryClient.invalidateQueries({ queryKey: ["owner-agreements-properties"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      onOpenChange(false);
      if (created) onCreated?.(created);
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
              : single
                ? "شقة أو فيلا أو دور مستقل؛ بعد الحفظ تكمل مواصفات الوحدة وأثاثها."
                : "عمارة أو برج أو مجمع؛ بعد الحفظ تضيف شققه دفعة واحدة أو كل شقة بمواصفاتها."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="نوع العقار">
          <StructureOption
            selected={single}
            onSelect={() => set("structure", "single")}
            icon={<Home className="size-5" />}
            title="وحدة مستقلة"
            hint="شقة، فيلا، دور، استراحة…"
          />
          <StructureOption
            selected={!single}
            onSelect={() => set("structure", "building")}
            icon={<Building2 className="size-5" />}
            title="عمارة أو برج"
            hint="مبنى فيه أكثر من وحدة"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={single ? "اسم الوحدة / العقار" : "اسم العمارة / البرج"}>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={single ? "مثال: فيلا النرجس" : "مثال: عمارة الملقا ٣"}
              />
            </Field>
          </div>
          {single ? (
            isEdit ? null : (
              <Field label="نوع الوحدة">
                <Select value={form.unit_type} onValueChange={(v) => set("unit_type", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SINGLE_UNIT_TYPE_GROUPS.map((g) => (
                      <SelectGroup key={g.group}>
                        <SelectLabel>{g.group}</SelectLabel>
                        {g.types.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )
          ) : (
            <Field label="نوع المبنى">
              <Select value={form.building_type} onValueChange={(v) => set("building_type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUILDING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                  {BUILDING_TYPES.includes(form.building_type) ? null : (
                    <SelectItem value={form.building_type}>{form.building_type}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
          )}
          {isEdit && !isOwner ? (
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
          ) : null}
          <Field label="المدينة">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="الحي">
            <Input value={form.district} onChange={(e) => set("district", e.target.value)} />
          </Field>
          <Field label="العنوان / الشارع">
            <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label={single ? "رقم الصك" : "رقم صك العمارة"}>
            <Input
              dir="ltr"
              value={form.deed_number}
              onChange={(e) => set("deed_number", e.target.value)}
            />
          </Field>
          {isOwner ? null : (
            <Field label="اسم المالك">
              <Input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
            </Field>
          )}
          <Field
            label={single ? "عدد الأدوار (للفيلا)" : "عدد الأدوار"}
            error={errors.floors_count}
          >
            <Input
              inputMode="numeric"
              value={form.floors_count}
              onChange={(e) => set("floors_count", e.target.value)}
              aria-invalid={Boolean(errors.floors_count)}
            />
          </Field>
          <Field label="سنة البناء" error={errors.year_built}>
            <Input
              inputMode="numeric"
              value={form.year_built}
              onChange={(e) => set("year_built", e.target.value)}
              placeholder="مثال: 2018"
              aria-invalid={Boolean(errors.year_built)}
            />
          </Field>
          {single ? null : (
            <Field label="عدد المصاعد" error={errors.elevators}>
              <Input
                inputMode="numeric"
                value={form.elevators}
                onChange={(e) => set("elevators", e.target.value)}
                aria-invalid={Boolean(errors.elevators)}
              />
            </Field>
          )}
          <Field label="عدد المواقف" error={errors.parking_spaces}>
            <Input
              inputMode="numeric"
              value={form.parking_spaces}
              onChange={(e) => set("parking_spaces", e.target.value)}
              aria-invalid={Boolean(errors.parking_spaces)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="الموقع على الخريطة (يظهر تقريبيًا للعموم)" error={locationError}>
              <Input
                dir="ltr"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="24.8073, 46.6129  أو  https://www.google.com/maps/…"
                aria-invalid={Boolean(locationError)}
              />
              {locationError ? null : (
                <p className="text-xs text-muted-foreground">
                  {isOwner
                    ? "يساعدنا الموقع على اقتراح أقرب المكاتب لعقارك."
                    : "بدون موقع لن تظهر الوحدات على الخريطة. يمكنك تحديده لاحقًا من صفحة الخريطة."}
                </p>
              )}
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.name.trim() || Boolean(formError) || save.isPending}
          >
            {isEdit
              ? "حفظ التعديلات"
              : single
                ? "حفظ ومتابعة لمواصفات الوحدة"
                : "حفظ ومتابعة لإضافة الوحدات"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StructureOption({
  selected,
  onSelect,
  icon,
  title,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex items-start gap-3 border p-3 text-start transition-colors ${
        selected ? "border-foreground bg-muted/60" : "border-input hover:bg-muted/40"
      }`}
    >
      <span className="mt-0.5 text-brass">{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
