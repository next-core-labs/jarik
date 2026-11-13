import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Home, LocateFixed, Search } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
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
import { isInSaudi, isShortMapLink, parseLocation } from "@/lib/location-input";
import { resolveMapLink, searchPlaces, type PlaceHit } from "@/lib/map-link.functions";
import { Skeleton } from "@/components/ui/skeleton";
import { parseAmount } from "@/lib/public-form";
import {
  BUILDING_TYPES,
  PROPERTY_TYPE_GROUPS,
  SINGLE_UNIT_TYPE_GROUPS,
  groupOfType,
  type PropertyStructure,
} from "@/lib/property-types";
import { deedFormatError, normalizeDeed } from "@/lib/unit-duplicates";

// Leaflet needs the browser: the picker loads only when the dialog shows it.
const LocationPickerMap = lazy(() => import("@/components/location-picker-map"));

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
  /** How many units it has: a property with more than one can't become a single unit. */
  unitsCount?: number;
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
  // A building with several units can't be turned into one standalone unit.
  const multiUnit = (property?.unitsCount ?? 0) > 1;
  const location = form.location.trim() ? parseLocation(form.location) : null;

  // A short share link (maps.app.goo.gl/…) carries no coordinates: open it on the server and put
  // the coordinates it points to into the field.
  const resolveLink = useServerFn(resolveMapLink);
  const shortLink = open && isShortMapLink(form.location) ? form.location.trim() : "";
  const resolved = useQuery({
    queryKey: ["resolve-map-link", shortLink],
    enabled: shortLink !== "",
    retry: false,
    staleTime: Infinity,
    queryFn: () => resolveLink({ data: { url: shortLink } }),
  });
  useEffect(() => {
    const point = resolved.data;
    if (!point || !shortLink) return;
    setForm((f) =>
      f.location.trim() === shortLink ? { ...f, location: `${point.lat}, ${point.lng}` } : f,
    );
  }, [resolved.data, shortLink]);

  // Reading a short link is progress, not an error: a neutral note, but saving waits for it.
  const locationPending = Boolean(shortLink && (resolved.isPending || resolved.data));
  const locationError =
    !form.location.trim() || locationPending
      ? null
      : !location
        ? shortLink
          ? "تعذّر قراءة الموقع من الرابط المختصر — افتح الرابط في خرائط جوجل وانسخ الإحداثيات أو الرابط الكامل"
          : "الصق الإحداثيات (24.81, 46.61) أو رابط خرائط جوجل"
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

  // A deed registered on another property is refused (guard_property_deed_duplicate); say so first.
  const deedNorm = normalizeDeed(form.deed_number);
  const deedFormat =
    form.deed_number !== (property?.deed_number ?? "") ? deedFormatError(form.deed_number) : null;
  const [deedToCheck, setDeedToCheck] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDeedToCheck(deedFormat ? "" : deedNorm), 400);
    return () => clearTimeout(t);
  }, [deedNorm, deedFormat]);
  const checkDeed =
    open && deedToCheck !== "" && deedToCheck !== normalizeDeed(property?.deed_number);
  const deedUse = useQuery({
    queryKey: ["deed-in-use", "property", deedToCheck, property?.id ?? null],
    enabled: checkDeed,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("deed_number_in_use", {
        _kind: "property",
        _deed: deedToCheck,
        ...(property ? { _property_id: property.id } : {}),
      });
      if (error) throw error;
      return data;
    },
  });
  const deedError =
    deedFormat ??
    (checkDeed && deedToCheck === deedNorm && deedUse.data === "other_property"
      ? "رقم الصك مسجّل لعقار آخر على جارك — تأكد من الرقم، ولا تسجّل العقار مرتين"
      : null);

  const formError =
    locationError ??
    (locationPending ? "جارٍ قراءة الموقع من الرابط…" : null) ??
    deedError ??
    Object.values(errors).find((e) => e !== null) ??
    null;

  // The property's columns as this form would write them — also applied to the saved property, so
  // an edit sends only what changed.
  const toValues = (f: Form) => {
    const isSingle = f.structure === "single";
    const loc = f.location.trim() ? parseLocation(f.location) : null;
    return {
      name: f.name.trim(),
      structure: f.structure,
      // A new property's broad class follows its unit/building type; an edit keeps the saved one
      // (the office changes it from «التصنيف»).
      property_type: isEdit
        ? f.property_type
        : groupOfType(isSingle ? f.unit_type : f.building_type),
      building_type: isSingle ? null : f.building_type,
      city: f.city.trim() || null,
      district: f.district.trim() || null,
      address: f.address.trim() || null,
      deed_number: f.deed_number.trim() || null,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      floors_count: wholeIn(f.floors_count, 0, 300) ?? null,
      year_built: wholeIn(f.year_built, 1900, 2100) ?? null,
      elevators: isSingle ? null : (wholeIn(f.elevators, 0, 100) ?? null),
      parking_spaces: wholeIn(f.parking_spaces, 0, 10000) ?? null,
      ...(isOwner ? {} : { owner_name: f.owner_name.trim() || null }),
    };
  };

  const save = useMutation({
    mutationFn: async (): Promise<CreatedProperty | null> => {
      if (formError) throw new Error(formError);
      const values = toValues(form);
      if (property) {
        const before = toValues(formFrom(property));
        const changes: TablesUpdate<"properties"> = {};
        for (const [column, value] of Object.entries(values)) {
          if (JSON.stringify(value) !== JSON.stringify(before[column as keyof typeof before])) {
            (changes as Record<string, unknown>)[column] = value;
          }
        }
        if (Object.keys(changes).length === 0) return null;
        const { data, error } = await supabase
          .from("properties")
          .update(changes)
          .eq("id", property.id)
          .select("id");
        if (error) throw error;
        if (!data?.length) {
          throw new Error("لم تُحفظ التعديلات — ليست لديك صلاحية تعديل هذا العقار");
        }
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
            hint={multiUnit ? "غير متاح — في العقار أكثر من وحدة" : "شقة، فيلا، دور، استراحة…"}
            disabled={multiUnit && !single}
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
          <Field label={single ? "رقم الصك" : "رقم صك العمارة"} error={deedError}>
            <Input
              dir="ltr"
              value={form.deed_number}
              onChange={(e) => set("deed_number", e.target.value)}
              aria-invalid={Boolean(deedError)}
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
              <LocationPicker
                open={open}
                point={location && isInSaudi(location) ? location : null}
                onPick={(p) => set("location", `${p.lat}, ${p.lng}`)}
              />
              <Input
                dir="ltr"
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="24.8073, 46.6129  أو  رابط خرائط جوجل"
                aria-label="الإحداثيات أو رابط خرائط جوجل"
                aria-invalid={Boolean(locationError)}
              />
              {locationPending ? (
                <p className="text-xs text-muted-foreground" role="status">
                  جارٍ قراءة الموقع من الرابط…
                </p>
              ) : locationError ? null : (
                <p className="text-xs text-muted-foreground">
                  اضغط على الخريطة لوضع الدبوس واسحبه للتعديل، أو ابحث عن الحي، أو الصق الإحداثيات
                  أو رابط خرائط جوجل.{" "}
                  {isOwner
                    ? "يساعدنا الموقع على اقتراح أقرب المكاتب لعقارك."
                    : "بدون موقع لن تظهر الوحدات على الخريطة."}
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
  disabled = false,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex items-start gap-3 border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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

/**
 * The map part of «الموقع على الخريطة»: search a district or landmark, «موقعي الحالي», and the map
 * itself (tap to drop the pin, drag to adjust). The picked point is written into the field above,
 * so pasting coordinates or a Google Maps link keeps working.
 */
function LocationPicker({
  open,
  point,
  onPick,
}: {
  open: boolean;
  point: { lat: number; lng: number } | null;
  onPick: (p: { lat: number; lng: number }) => void;
}) {
  const search = useServerFn(searchPlaces);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlaceHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [flyTo, setFlyTo] = useState<{
    point: { lat: number; lng: number };
    zoom: number;
    key: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits(null);
      setFlyTo(null);
    }
  }, [open]);

  async function runSearch() {
    const q = query.trim();
    if (q.length < 2) {
      toast.info("اكتب حرفين على الأقل من اسم الحي أو المعلم");
      return;
    }
    setSearching(true);
    try {
      const rows = await search({ data: { q } });
      setHits(rows);
      if (rows.length === 0) toast.info("لم نجد هذا المكان — جرّب اسم الحي مع المدينة");
    } catch (e) {
      toast.error(userErrorMessage(e, "تعذّر البحث الآن"));
    } finally {
      setSearching(false);
    }
  }

  function locateMe() {
    if (!navigator.geolocation) {
      toast.error("جهازك لا يدعم تحديد الموقع");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = {
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
        };
        onPick(p);
        setFlyTo({ point: p, zoom: 17, key: Date.now() });
      },
      () => {
        setLocating(false);
        toast.error("تعذّر تحديد موقعك — اسمح للمتصفح بالوصول إلى الموقع أو حدّده على الخريطة");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form
          className="flex min-w-[14rem] flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن حي أو معلم"
            aria-label="البحث عن مكان"
          />
          <Button type="submit" variant="outline" size="icon" disabled={searching} aria-label="بحث">
            <Search className="size-4" />
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          onClick={locateMe}
          disabled={locating}
          className="shrink-0"
        >
          <LocateFixed className="size-4" />
          {locating ? "جارٍ التحديد…" : "موقعي الحالي"}
        </Button>
      </div>
      {hits && hits.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {hits.map((h) => (
            <li key={`${h.lat},${h.lng}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start hover:bg-muted"
                onClick={() => {
                  // The result is the choice: drop the pin there too (drag it to refine).
                  const p = { lat: h.lat, lng: h.lng };
                  onPick(p);
                  setFlyTo({ point: p, zoom: 16, key: Date.now() });
                  setHits(null);
                }}
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <LocationPickerMap value={point} onChange={onPick} flyTo={flyTo} />
        </Suspense>
      ) : null}
    </div>
  );
}
