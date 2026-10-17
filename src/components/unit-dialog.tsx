import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Sparkles, Trash2, Wrench } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayRiyadh } from "@/lib/dates";
import { sar, shortDate } from "@/lib/format";
import { listClientAccounts } from "@/lib/admin-users.functions";
import { parseAmount } from "@/lib/public-form";
import { suggestRent } from "@/lib/pricing.functions";
import { AMENITIES } from "@/lib/amenities";
import { PROPERTY_TYPE_GROUPS, PROPERTY_TYPES, type ListingPurpose } from "@/lib/property-types";
import { mediaUrl, syncUnitPhotos, type ExistingPhoto, type PhotoItem } from "@/lib/unit-photos";
import { isFurnishing, parseFurniture, type Furnishing, type FurnitureItem } from "@/lib/furniture";
import { UnitPhotosEditor } from "@/components/unit-photos-editor";
import { FurnitureEditor } from "@/components/furniture-editor";

export type UnitFormValues = {
  id?: string;
  unit_number: string;
  unit_name: string;
  unit_type: string;
  district: string;
  street: string;
  floor_no: string;
  rooms: string;
  halls: string;
  bathrooms: string;
  area: string;
  annual_rent: string;
  sale_price: string;
  listing_purpose: ListingPurpose;
  /** مزاد عكسي اختياري: تخفيض تلقائي للسعر عند طول شغور الوحدة، بحد أدنى price_floor. */
  auto_price_decay: boolean;
  price_floor: string;
  /** Only meaningful for listing_purpose "sale": "vacant" (still for sale) or "sold". A rental's
      status is derived automatically from its lease and is never sent from this form. */
  status: string;
  electricity_meter_no: string;
  water_meter_no: string;
  /** صك الوحدة — a building's apartments often each carry their own (صك مفرز). */
  deed_number: string;
  furnishing: Furnishing;
  furniture: FurnitureItem[];
  furniture_notes: string;
  owner_id: string;
  notes: string;
  /** Public description shown on the listing in the offers market. */
  listing_description: string;
  amenities: string[];
  /** Advertise the unit in the public offers market while it is vacant. */
  market_listed: boolean;
};

export const emptyUnit: UnitFormValues = {
  unit_number: "",
  unit_name: "",
  unit_type: "شقة",
  district: "",
  street: "",
  floor_no: "",
  rooms: "",
  halls: "",
  bathrooms: "",
  area: "",
  annual_rent: "",
  sale_price: "",
  listing_purpose: "rent",
  auto_price_decay: false,
  price_floor: "",
  status: "vacant",
  electricity_meter_no: "",
  water_meter_no: "",
  deed_number: "",
  furnishing: "none",
  furniture: [],
  furniture_notes: "",
  owner_id: "none",
  notes: "",
  listing_description: "",
  amenities: [],
  market_listed: true,
};

/** The saved unit as the columns the properties screens load it. */
export type UnitRowForForm = {
  id: string;
  unit_number: string | null;
  unit_name: string | null;
  unit_type: string | null;
  district: string | null;
  street: string | null;
  floor_no: string | null;
  rooms: number | null;
  halls: number | null;
  bathrooms: number | null;
  area: number | null;
  annual_rent: number | null;
  sale_price: number | null;
  listing_purpose: string | null;
  auto_price_decay: boolean | null;
  price_floor: number | null;
  status: string | null;
  electricity_meter_no: string | null;
  water_meter_no: string | null;
  deed_number: string | null;
  furnishing: string | null;
  furniture: unknown;
  furniture_notes: string | null;
  owner_id: string | null;
  notes: string | null;
};

/**
 * The form for a saved unit. `copy` starts a new unit from it instead (same specs and furniture,
 * no number, deed or meters) — the quick way through a building of identical apartments.
 */
export function unitFormFromRow(u: UnitRowForForm, copy = false): UnitFormValues {
  const values: UnitFormValues = {
    id: u.id,
    unit_number: u.unit_number ?? "",
    unit_name: u.unit_name ?? "",
    unit_type: u.unit_type ?? "شقة",
    district: u.district ?? "",
    street: u.street ?? "",
    floor_no: u.floor_no ?? "",
    rooms: u.rooms == null ? "" : String(u.rooms),
    halls: String(u.halls ?? 0),
    bathrooms: String(u.bathrooms ?? 0),
    area: u.area == null ? "" : String(u.area),
    annual_rent: String(u.annual_rent ?? 0),
    sale_price: String(u.sale_price ?? 0),
    listing_purpose: u.listing_purpose === "sale" ? "sale" : "rent",
    auto_price_decay: Boolean(u.auto_price_decay),
    price_floor: u.price_floor == null ? "" : String(u.price_floor),
    status: u.status ?? "vacant",
    electricity_meter_no: u.electricity_meter_no ?? "",
    water_meter_no: u.water_meter_no ?? "",
    deed_number: u.deed_number ?? "",
    furnishing: isFurnishing(u.furnishing) ? u.furnishing : "none",
    furniture: parseFurniture(u.furniture),
    furniture_notes: u.furniture_notes ?? "",
    owner_id: u.owner_id ?? "none",
    notes: u.notes ?? "",
    // Loaded by the dialog itself (see UnitDialog), so the screens do not depend on these columns.
    listing_description: "",
    amenities: [],
    market_listed: false,
  };
  if (!copy) return values;
  const { id: _id, ...rest } = values;
  return {
    ...rest,
    unit_number: "",
    unit_name: "",
    status: "vacant",
    electricity_meter_no: "",
    water_meter_no: "",
    deed_number: "",
    notes: "",
    market_listed: emptyUnit.market_listed,
  };
}

/**
 * A typed quantity: undefined when left empty, null when it is not a number ≥ 0 (or not a whole
 * number when `whole`). Arabic-Indic digits and thousands separators are accepted (parseAmount).
 */
function parseQuantity(v: string, whole = false): number | null | undefined {
  const n = parseAmount(v);
  if (n === undefined || n === null) return n;
  return whole && !Number.isInteger(n) ? null : n;
}

export function UnitDialog({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  initial,
  canManage,
  leaseTenant = null,
  mode = "office",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  propertyName: string;
  initial: UnitFormValues;
  canManage: boolean;
  /** The tenant on the unit's active lease — the only source of who lives in the unit. */
  leaseTenant?: string | null;
  /**
   * "owner": an owner editing a unit of their own property. Only its description and specs —
   * occupancy, market publication, pricing automation and repair invoices belong to the office
   * that manages it (the database enforces the same: guard_owner_unit_write).
   */
  mode?: "office" | "owner";
}) {
  const isOwner = mode === "owner";
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UnitFormValues>(initial);
  const isEdit = Boolean(initial.id);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  // The public listing text of an existing unit is loaded here (not by the properties screen).
  const listingFields = useQuery({
    queryKey: ["unit-listing-fields", initial.id],
    enabled: open && Boolean(initial.id),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("listing_description, amenities, market_listed")
        .eq("id", initial.id!)
        .single();
      if (error) throw error;
      return data;
    },
  });
  // Applies the fetched listing fields into the form exactly once per mount, so it doesn't clobber
  // the user's in-progress edits on every refetch — but it must wait for a *settled* value: a
  // reopen within react-query's cache window returns the (possibly stale, pre-save) cached data
  // synchronously while revalidating in the background, and applying that first would lock the
  // guard onto stale text before the fresh refetch ever lands.
  const listingLoaded = useRef(false);
  useEffect(() => {
    if (listingLoaded.current || !listingFields.data || listingFields.isFetching) return;
    listingLoaded.current = true;
    const { listing_description, amenities, market_listed } = listingFields.data;
    setForm((f) => ({
      ...f,
      listing_description: listing_description ?? "",
      amenities: amenities ?? [],
      market_listed,
    }));
  }, [listingFields.data, listingFields.isFetching]);

  // Photos: the saved ones are loaded once, then edited locally and written on save.
  const savedPhotos = useQuery({
    queryKey: ["unit-photos", initial.id],
    enabled: open && Boolean(initial.id) && !isOwner,
    queryFn: async (): Promise<ExistingPhoto[]> => {
      const { data, error } = await supabase
        .from("unit_photos")
        .select("id, path, position")
        .eq("unit_id", initial.id!)
        .order("position");
      if (error) throw error;
      return data;
    },
  });
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([]);
  const photosInitialised = useRef(false);
  useEffect(() => {
    if (photosInitialised.current || !savedPhotos.data) return;
    photosInitialised.current = true;
    setPhotoItems(
      savedPhotos.data.map((p) => ({
        key: p.id,
        id: p.id,
        path: p.path,
        file: null,
        preview: mediaUrl(p.path),
      })),
    );
  }, [savedPhotos.data]);

  const set = <K extends keyof UnitFormValues>(key: K, value: UnitFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const fetchClients = useServerFn(listClientAccounts);
  const clients = useQuery({
    queryKey: ["client-accounts"],
    queryFn: () => fetchClients(),
    enabled: canManage && !isOwner,
  });
  // Only owner accounts can own a unit — not the office's staff, tenants or technicians. A unit
  // already assigned to someone else keeps that option so the field doesn't show blank.
  const ownerOptions = (clients.data ?? []).filter(
    (c) => c.roles.includes("owner") || c.id === initial.owner_id,
  );

  const rooms = parseQuantity(form.rooms, true);
  const halls = parseQuantity(form.halls, true);
  const bathrooms = parseQuantity(form.bathrooms, true);
  const area = parseQuantity(form.area);
  const annualRent = parseQuantity(form.annual_rent);
  const salePrice = parseQuantity(form.sale_price);
  const priceFloor = parseQuantity(form.price_floor);
  const errors = {
    rooms: rooms === null ? "عدد الغرف رقم صحيح (0 أو أكثر)" : null,
    halls: halls === null ? "عدد الصالات رقم صحيح (0 أو أكثر)" : null,
    bathrooms: bathrooms === null ? "عدد الحمامات رقم صحيح (0 أو أكثر)" : null,
    area: area === null ? "المساحة رقم بالمتر المربع" : null,
    annual_rent:
      form.listing_purpose === "rent" && annualRent === null ? "الإيجار السنوي رقم بالريال" : null,
    sale_price:
      form.listing_purpose === "sale" && salePrice === null ? "سعر البيع رقم بالريال" : null,
    price_floor:
      form.auto_price_decay && !(priceFloor && priceFloor > 0)
        ? "حدّد حدًا أدنى صحيحًا للسعر قبل تفعيل التخفيض التلقائي"
        : null,
  };
  const formError = Object.values(errors).find((e) => e !== null) ?? null;

  const fetchSuggestion = useServerFn(suggestRent);
  const suggest = useMutation({
    mutationFn: () =>
      fetchSuggestion({
        data: {
          unitType: form.unit_type,
          district: form.district.trim(),
          rooms: rooms ?? null,
          halls: halls ?? 0,
          bathrooms: bathrooms ?? 0,
          area: area ?? null,
          furnished: form.furnishing !== "none",
          floorNo: form.floor_no.trim() || null,
        },
      }),
    onSuccess: (res) => {
      if (res.suggestedRent) set("annual_rent", String(res.suggestedRent));
      if (res.source === "ai") toast.success(res.reasoning);
      else if (res.suggestedRent) toast.info(res.reasoning);
      else toast.warning(res.reasoning);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر جلب التسعير")),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const furnished = form.furnishing !== "none";
      const payload = {
        property_id: propertyId,
        unit_number: form.unit_number.trim(),
        unit_name: form.unit_name.trim() || null,
        unit_type: form.unit_type,
        district: form.district.trim() || null,
        street: form.street.trim() || null,
        floor_no: form.floor_no.trim() || null,
        rooms: rooms ?? null,
        halls: halls ?? 0,
        bathrooms: bathrooms ?? 0,
        area: area ?? null,
        annual_rent: annualRent ?? 0,
        sale_price: salePrice ?? 0,
        listing_purpose: form.listing_purpose,
        auto_price_decay: form.auto_price_decay,
        price_floor: form.auto_price_decay ? (priceFloor ?? null) : null,
        // A rental's status is derived from its lease (sync_unit_status); sending it here would
        // fight that trigger. Only a sale unit's status is staff-set, so only it is sent.
        ...(form.listing_purpose === "sale" && !isOwner ? { status: form.status } : {}),
        electricity_meter_no: form.electricity_meter_no.trim() || null,
        water_meter_no: form.water_meter_no.trim() || null,
        deed_number: form.deed_number.trim() || null,
        // `furnished` (the market flag) follows `furnishing` in the database (a1_sync_furnishing).
        furnishing: form.furnishing,
        furniture: furnished ? form.furniture : [],
        furniture_notes: furnished ? form.furniture_notes.trim() || null : null,
        // An owner's own unit is always theirs (the database sets it).
        ...(isOwner ? {} : { owner_id: form.owner_id === "none" ? null : form.owner_id }),
        notes: form.notes.trim() || null,
        listing_description: form.listing_description.trim() || null,
        amenities: form.amenities,
        // Only once the saved value is known (a failed load must not silently unpublish), and the
        // listing date is stamped only when the unit newly goes on the market.
        ...(!isOwner && (!isEdit || listingFields.data)
          ? {
              market_listed: form.market_listed,
              ...(form.market_listed && !listingFields.data?.market_listed
                ? { market_listed_at: new Date().toISOString() }
                : {}),
            }
          : {}),
      };
      let unitId = form.id;
      if (unitId) {
        const { error } = await supabase.from("units").update(payload).eq("id", unitId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("units").insert(payload).select("id").single();
        if (error) throw error;
        unitId = data.id;
        // From here on a retry updates this unit instead of creating a second one.
        setForm((f) => ({ ...f, id: data.id }));
      }
      // Don't touch the photos of a unit whose saved photos never loaded (that would delete them).
      if (!isOwner && (!form.id || savedPhotos.data)) {
        await syncUnitPhotos(supabase, unitId, savedPhotos.data ?? [], photoItems);
        queryClient.invalidateQueries({ queryKey: ["unit-photos", unitId] });
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "تم تحديث الوحدة" : "تمت إضافة الوحدة");
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      queryClient.invalidateQueries({ queryKey: ["owner-own-properties"] });
      queryClient.invalidateQueries({ queryKey: ["owner-agreements-properties"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      queryClient.invalidateQueries({ queryKey: ["unit-listing-fields", form.id] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحفظ")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isEdit ? "تعديل بيانات الوحدة" : "تسجيل وحدة جديدة"}
          </DialogTitle>
          <DialogDescription>
            {propertyName}
            {isOwner ? " — مواصفات وحدتك كما ستصل للمكتب الذي تتعاقد معه." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="رقم الشقة / الوحدة">
            <Input
              value={form.unit_number}
              onChange={(e) => set("unit_number", e.target.value)}
              placeholder="مثال: 12"
            />
          </Field>
          <Field label="اسم الوحدة (اختياري)">
            <Input
              value={form.unit_name}
              onChange={(e) => set("unit_name", e.target.value)}
              placeholder="مثال: شقة الياسمين"
            />
          </Field>
          <Field label="النوع">
            <Select value={form.unit_type} onValueChange={(v) => set("unit_type", v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPE_GROUPS.map((g) => (
                  <SelectGroup key={g.group}>
                    <SelectLabel>{g.group}</SelectLabel>
                    {g.types.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
                {/* An office may have typed its own wording before this list existed. */}
                {PROPERTY_TYPES.includes(form.unit_type) ? null : (
                  <SelectItem value={form.unit_type}>{form.unit_type}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field label="الدور">
            <Input
              value={form.floor_no}
              onChange={(e) => set("floor_no", e.target.value)}
              placeholder="مثال: الثالث"
            />
          </Field>
          <Field label="الحي">
            <Input value={form.district} onChange={(e) => set("district", e.target.value)} />
          </Field>
          <Field label="الشارع">
            <Input value={form.street} onChange={(e) => set("street", e.target.value)} />
          </Field>
          <Field label="عدد الغرف" error={errors.rooms}>
            <Input
              inputMode="numeric"
              value={form.rooms}
              onChange={(e) => set("rooms", e.target.value)}
              aria-invalid={Boolean(errors.rooms)}
            />
          </Field>
          <Field label="عدد الصالات" error={errors.halls}>
            <Input
              inputMode="numeric"
              value={form.halls}
              onChange={(e) => set("halls", e.target.value)}
              aria-invalid={Boolean(errors.halls)}
            />
          </Field>
          <Field label="عدد الحمامات" error={errors.bathrooms}>
            <Input
              inputMode="numeric"
              value={form.bathrooms}
              onChange={(e) => set("bathrooms", e.target.value)}
              aria-invalid={Boolean(errors.bathrooms)}
            />
          </Field>
          <Field label="المساحة (م²)" error={errors.area}>
            <Input
              inputMode="decimal"
              value={form.area}
              onChange={(e) => set("area", e.target.value)}
              aria-invalid={Boolean(errors.area)}
            />
          </Field>
          <Field label="رقم صك الوحدة">
            <Input
              dir="ltr"
              value={form.deed_number}
              onChange={(e) => set("deed_number", e.target.value)}
              placeholder="إن كان للوحدة صك مستقل"
            />
          </Field>
          <Field label="نوع العرض">
            <Select
              value={form.listing_purpose}
              onValueChange={(v) => set("listing_purpose", v as ListingPurpose)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rent">للإيجار</SelectItem>
                <SelectItem value="sale">للبيع</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.listing_purpose === "sale" ? (
            <>
              <Field label="سعر البيع (ريال)" error={errors.sale_price}>
                <Input
                  inputMode="decimal"
                  value={form.sale_price}
                  onChange={(e) => set("sale_price", e.target.value)}
                  aria-invalid={Boolean(errors.sale_price)}
                />
              </Field>
              {isOwner ? null : (
                <Field label="حالة البيع">
                  <Select
                    value={form.status === "sold" ? "sold" : "vacant"}
                    onValueChange={(v) => set("status", v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vacant">متاحة للبيع</SelectItem>
                      <SelectItem value="sold">تم البيع</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </>
          ) : (
            <Field
              label={isOwner ? "الإيجار السنوي المتوقع (ريال)" : "الإيجار السنوي (ريال)"}
              error={errors.annual_rent}
            >
              <Input
                inputMode="decimal"
                value={form.annual_rent}
                onChange={(e) => set("annual_rent", e.target.value)}
                aria-invalid={Boolean(errors.annual_rent)}
              />
            </Field>
          )}
          {isOwner ? null : (
            <>
              <Field label="تخفيض تلقائي عند طول الشغور">
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    checked={form.auto_price_decay}
                    onCheckedChange={(v) => set("auto_price_decay", v)}
                  />
                  <span className="text-sm text-muted-foreground">
                    يخفَّض 2% أسبوعيًا بعد 14 يوم شغور
                  </span>
                </div>
              </Field>
              {form.auto_price_decay ? (
                <Field label="الحد الأدنى للسعر (ريال) — ما ينزل عنه" error={errors.price_floor}>
                  <Input
                    inputMode="decimal"
                    value={form.price_floor}
                    onChange={(e) => set("price_floor", e.target.value)}
                    aria-invalid={Boolean(errors.price_floor)}
                  />
                </Field>
              ) : null}
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => suggest.mutate()}
                  disabled={suggest.isPending}
                >
                  <Sparkles className="size-4 text-brass" />
                  {suggest.isPending ? "جارٍ التسعير..." : "اقترح سعر الإيجار"}
                </Button>
              </div>
            </>
          )}
          <Field label="رقم عداد الكهرباء">
            <Input
              dir="ltr"
              value={form.electricity_meter_no}
              onChange={(e) => set("electricity_meter_no", e.target.value)}
            />
          </Field>
          <Field label="رقم عداد المياه">
            <Input
              dir="ltr"
              value={form.water_meter_no}
              onChange={(e) => set("water_meter_no", e.target.value)}
            />
          </Field>
          <div className="rounded-lg border border-border p-4 sm:col-span-2">
            <FurnitureEditor
              furnishing={form.furnishing}
              items={form.furniture}
              notes={form.furniture_notes}
              disabled={!canManage || save.isPending}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  furnishing: v.furnishing,
                  furniture: v.items,
                  furniture_notes: v.notes,
                }))
              }
            />
          </div>
          {isOwner ? null : (
            <>
              <Field label="المالك">
                <Select value={form.owner_id} onValueChange={(v) => set("owner_id", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر المالك" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون مالك</SelectItem>
                    {ownerOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fullName || c.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="المستأجر">
                {/* Who lives in the unit comes from its active lease (it also drives the unit's
                status); a lease is created from «المستأجرون والعقود». */}
                <p className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
                  {leaseTenant ?? "بدون مستأجر"}
                </p>
                <p className="text-xs text-muted-foreground">
                  يُحدَّد من عقد الإيجار الساري — أنشئ العقد من «المستأجرون والعقود».
                </p>
              </Field>
            </>
          )}
          <div className="space-y-4 rounded-lg border border-border p-4 sm:col-span-2">
            {isOwner ? (
              <p className="text-xs text-muted-foreground">
                الوصف والمزايا تساعد المكتب على تسويق وحدتك؛ النشر في سوق العروض يتولاه المكتب بعد
                قبول اتفاقية الإدارة.
              </p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Label htmlFor="market_listed" className="font-medium">
                      الإعلان في سوق العروض
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      تظهر الوحدة للجميع في سوق العروض عندما تكون شاغرة ويكون «العرض العلني» مفعّلًا
                      في هوية المكتب ومعتمدًا من المنصة.
                    </p>
                  </div>
                  <Switch
                    id="market_listed"
                    checked={form.market_listed}
                    onCheckedChange={(v) => set("market_listed", v)}
                  />
                </div>
                <Field label="صور الوحدة">
                  <UnitPhotosEditor
                    items={photoItems}
                    onChange={setPhotoItems}
                    disabled={!canManage || save.isPending || (isEdit && savedPhotos.isLoading)}
                  />
                </Field>
              </>
            )}
            <Field label={isOwner ? "وصف الوحدة" : "وصف الإعلان (يظهر للعموم)"}>
              <Textarea
                rows={4}
                maxLength={2000}
                value={form.listing_description}
                onChange={(e) => set("listing_description", e.target.value)}
                placeholder="مثال: شقة جديدة بتشطيب فاخر، قريبة من المدارس والخدمات، مدخل خاص ومطبخ راكب…"
              />
            </Field>
            <Field label="المزايا والخدمات">
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
          <div className="sm:col-span-2">
            <Field label="ملاحظات">
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="أي تفاصيل تخص الوحدة"
              />
            </Field>
          </div>
        </div>

        {form.id && !isOwner ? <RepairInvoices unitId={form.id} canManage={canManage} /> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              !form.unit_number.trim() ||
              Boolean(formError) ||
              save.isPending ||
              // don't save over the listing text/photos before they have loaded
              (isEdit && (listingFields.isLoading || savedPhotos.isLoading))
            }
          >
            {isEdit ? "حفظ التعديلات" : "إضافة الوحدة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function RepairInvoices({ unitId, canManage }: { unitId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayRiyadh());

  const list = useQuery({
    queryKey: ["repair-invoices", unitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("repair_invoices")
        .select("id, title, vendor, amount, invoice_date, invoice_number, notes")
        .eq("unit_id", unitId)
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const parsedAmount = parseAmount(amount);
  const amountError =
    amount.trim() && !(parsedAmount && parsedAmount > 0) ? "المبلغ رقم أكبر من صفر بالريال" : null;

  const add = useMutation({
    mutationFn: async () => {
      if (!parsedAmount || parsedAmount <= 0) throw new Error("أدخل مبلغ الفاتورة بالريال");
      const { error } = await supabase.from("repair_invoices").insert({
        unit_id: unitId,
        title: title.trim(),
        vendor: vendor.trim() || null,
        amount: parsedAmount,
        invoice_date: invoiceDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle("");
      setVendor("");
      setAmount("");
      toast.success("تمت إضافة فاتورة الإصلاح");
      queryClient.invalidateQueries({ queryKey: ["repair-invoices", unitId] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّرت الإضافة")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("repair_invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repair-invoices", unitId] }),
  });

  const total = (list.data ?? []).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="mt-2 rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 font-medium">
          <Wrench className="size-4 text-brass" />
          فواتير الإصلاح
        </p>
        <span className="text-sm text-muted-foreground">الإجمالي {sar(total)}</span>
      </div>

      <div className="space-y-2">
        {(list.data ?? []).map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground">
                {r.vendor ? `${r.vendor} · ` : ""}
                {shortDate(r.invoice_date)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span>{sar(Number(r.amount))}</span>
              {canManage ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove.mutate(r.id)}
                  aria-label="حذف الفاتورة"
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        {(list.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد فواتير إصلاح لهذه الوحدة.</p>
        ) : null}
      </div>

      {canManage ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <Input
            placeholder="وصف الإصلاح"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input placeholder="المنفّذ" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          <Input
            className="sm:w-28"
            inputMode="decimal"
            placeholder="المبلغ"
            aria-label="مبلغ الفاتورة"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(amountError)}
          />
          <Input
            className="sm:w-40"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
          {amountError ? (
            <p className="text-xs text-destructive sm:col-span-4">{amountError}</p>
          ) : null}
          <Button
            className="sm:col-span-4"
            variant="outline"
            onClick={() => add.mutate()}
            disabled={!title.trim() || !parsedAmount || Boolean(amountError) || add.isPending}
          >
            <Plus className="size-4" />
            إضافة فاتورة إصلاح
          </Button>
        </div>
      ) : null}
    </div>
  );
}
