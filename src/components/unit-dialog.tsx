import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Sparkles, Trash2, Wrench } from "lucide-react";
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
import { startListingPayment } from "@/lib/listing-payments.functions";
import { canListWithoutPaying, LISTING_FEE_LABEL, marketState } from "@/lib/listing-fee";
import { isMoyasarCheckoutUrl } from "@/lib/moyasar-url";
import { myOrgId } from "@/lib/use-org-branding";
import { AMENITIES } from "@/lib/amenities";
import { PROPERTY_TYPE_GROUPS, PROPERTY_TYPES, type ListingPurpose } from "@/lib/property-types";
import { mediaUrl, syncUnitPhotos, type ExistingPhoto, type PhotoItem } from "@/lib/unit-photos";
import { isFurnishing, parseFurniture, type Furnishing, type FurnitureItem } from "@/lib/furniture";
import { deedFormatError, normalizeDeed, normalizeUnitNumber } from "@/lib/unit-duplicates";
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
  // Publishing is paid (listing-fee.ts), so a new unit starts off the market.
  market_listed: false,
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
 * What this account may not change on the unit while an office manages it under an agreement — the
 * database refuses the same (guard_owner_unit_write for the owner, guard_unit_agreement_columns for
 * the office). Locked fields show disabled and are never sent.
 */
export type UnitLocks = {
  /** annual_rent and sale_price (sale_price also follows `details`) */
  rent?: boolean;
  /** listing_description, amenities, notes */
  advert?: boolean;
  /** deed number and furniture */
  deed?: boolean;
  /** everything else: specs, meters, sale, owner, website publication, photos */
  details?: boolean;
  /** Why, shown under the dialog title. */
  note?: string;
};

const LOCK_GROUP: Record<string, keyof Omit<UnitLocks, "note">> = {
  annual_rent: "rent",
  listing_description: "advert",
  amenities: "advert",
  notes: "advert",
  deed_number: "deed",
  furnishing: "deed",
  furniture: "deed",
  furniture_notes: "deed",
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
  locks,
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
  locks?: UnitLocks;
}) {
  const isOwner = mode === "owner";
  const lock = {
    rent: Boolean(locks?.rent),
    advert: Boolean(locks?.advert),
    deed: Boolean(locks?.deed),
    details: Boolean(locks?.details),
  };
  // A unit managed under an agreement keeps its owner: only its own office assigns one.
  const ownerFixed = Boolean(locks);
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
        .select("listing_description, amenities, market_listed, market_paid_until, market_org_id")
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
  // Where the saved unit stands on the website for this office (another office's leftover paid days
  // are not its own); a new unit has never been published.
  const myOffice = useQuery({
    queryKey: ["my-org-id-for-unit"],
    enabled: open && !isOwner,
    staleTime: 60_000,
    queryFn: () => myOrgId(),
  });
  const market = marketState(
    listingFields.data ?? { market_listed: false, market_paid_until: null },
    undefined,
    myOffice.data ?? null,
  );
  // The switch shows the unit as published only when it is published for this office.
  const shownListed = Boolean(listingFields.data?.market_listed) && canListWithoutPaying(market);
  const listingLoaded = useRef(false);
  useEffect(() => {
    if (listingLoaded.current || !listingFields.data || listingFields.isFetching) return;
    if (!isOwner && myOffice.isFetching) return;
    listingLoaded.current = true;
    const { listing_description, amenities } = listingFields.data;
    setForm((f) => ({
      ...f,
      listing_description: listing_description ?? "",
      amenities: amenities ?? [],
      market_listed: shownListed,
    }));
  }, [listingFields.data, listingFields.isFetching, isOwner, myOffice.isFetching, shownListed]);

  // Switching the unit on without a paid period (or a free legacy listing) saves it unlisted and then
  // sends the office to pay; the database refuses to list it before then (guard_market_publish).
  const needsPayment =
    !isOwner && !lock.details && form.market_listed && !canListWithoutPaying(market);
  const startPayment = useServerFn(startListingPayment);

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

  // Duplicates are refused by the database (guard_unit_duplicates); these say so before saving.
  const siblings = useQuery({
    queryKey: ["property-unit-numbers", propertyId],
    enabled: open && !lock.details,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id, unit_number")
        .eq("property_id", propertyId);
      if (error) throw error;
      return data;
    },
  });
  const numberTaken =
    Boolean(form.unit_number.trim()) &&
    (siblings.data ?? []).some(
      (u) =>
        u.id !== form.id &&
        normalizeUnitNumber(u.unit_number) === normalizeUnitNumber(form.unit_number),
    );

  const deedNorm = normalizeDeed(form.deed_number);
  // Only a typed deed is held to the format; a saved one is left as it is.
  const deedFormat =
    !lock.deed && form.deed_number !== initial.deed_number
      ? deedFormatError(form.deed_number)
      : null;
  const [deedToCheck, setDeedToCheck] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDeedToCheck(deedFormat ? "" : deedNorm), 400);
    return () => clearTimeout(t);
  }, [deedNorm, deedFormat]);
  // A saved unit's own deed is not re-checked; a new unit's always is.
  const checkDeed =
    open &&
    !lock.deed &&
    deedToCheck !== "" &&
    (!initial.id || deedToCheck !== normalizeDeed(initial.deed_number));
  const deedUse = useQuery({
    queryKey: ["deed-in-use", "unit", deedToCheck, propertyId, initial.id ?? null],
    enabled: checkDeed,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("deed_number_in_use", {
        _kind: "unit",
        _deed: deedToCheck,
        _property_id: propertyId,
        ...(initial.id ? { _unit_id: initial.id } : {}),
      });
      if (error) throw error;
      return data;
    },
  });
  const deedState = checkDeed && deedToCheck === deedNorm ? (deedUse.data ?? null) : null;

  const rooms = parseQuantity(form.rooms, true);
  const halls = parseQuantity(form.halls, true);
  const bathrooms = parseQuantity(form.bathrooms, true);
  const area = parseQuantity(form.area);
  const annualRent = parseQuantity(form.annual_rent);
  const salePrice = parseQuantity(form.sale_price);
  const priceFloor = parseQuantity(form.price_floor);
  const errors = {
    unit_number: numberTaken ? "رقم الوحدة مسجّل بالفعل في هذا العقار" : null,
    deed_number:
      deedFormat ??
      (deedState === "other_property"
        ? "رقم الصك مسجّل لوحدة في عقار آخر على جارك — تأكد من الرقم، ولا تسجّل الوحدة مرتين"
        : null),
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

  // The unit's columns as this form would write them — also applied to `initial`, so an edit sends
  // only what the user changed and never overwrites the other side's edits with stale values.
  const toRow = (v: UnitFormValues) => {
    const furnished = v.furnishing !== "none";
    const decay = v.auto_price_decay;
    return {
      unit_number: v.unit_number.trim(),
      unit_name: v.unit_name.trim() || null,
      unit_type: v.unit_type,
      district: v.district.trim() || null,
      street: v.street.trim() || null,
      floor_no: v.floor_no.trim() || null,
      rooms: parseQuantity(v.rooms, true) ?? null,
      halls: parseQuantity(v.halls, true) ?? 0,
      bathrooms: parseQuantity(v.bathrooms, true) ?? 0,
      area: parseQuantity(v.area) ?? null,
      annual_rent: parseQuantity(v.annual_rent) ?? 0,
      sale_price: parseQuantity(v.sale_price) ?? 0,
      listing_purpose: v.listing_purpose,
      auto_price_decay: decay,
      price_floor: decay ? (parseQuantity(v.price_floor) ?? null) : null,
      // A rental's status is derived from its lease (sync_unit_status); sending it here would
      // fight that trigger. Only a sale unit's status is staff-set, so only it is sent.
      ...(v.listing_purpose === "sale" && !isOwner ? { status: v.status } : {}),
      electricity_meter_no: v.electricity_meter_no.trim() || null,
      water_meter_no: v.water_meter_no.trim() || null,
      deed_number: v.deed_number.trim() || null,
      // `furnished` (the market flag) follows `furnishing` in the database (a1_sync_furnishing).
      furnishing: v.furnishing,
      furniture: furnished ? v.furniture : [],
      furniture_notes: furnished ? v.furniture_notes.trim() || null : null,
      // An owner's own unit is always theirs (the database sets it).
      ...(isOwner ? {} : { owner_id: v.owner_id === "none" ? null : v.owner_id }),
      notes: v.notes.trim() || null,
      listing_description: v.listing_description.trim() || null,
      amenities: v.amenities,
    };
  };
  // The price is the owner's to change unless the agreement grants pricing; an agreement office
  // changes the sale price only with pricing and leasing (guard_unit_agreement_columns).
  const locked = (column: string) =>
    column === "sale_price" ? lock.rent || lock.details : lock[LOCK_GROUP[column] ?? "details"];

  const save = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const row = toRow(form);
      const listed = form.market_listed && !needsPayment;
      let unitId = form.id;
      if (unitId) {
        const saved = listingFields.data;
        const before = toRow({
          ...initial,
          listing_description: saved?.listing_description ?? "",
          amenities: saved?.amenities ?? [],
        });
        const changes: TablesUpdate<"units"> = {};
        for (const [column, value] of Object.entries(row)) {
          if (locked(column)) continue;
          // A listing text that never loaded is not written over.
          if (!saved && (column === "listing_description" || column === "amenities")) continue;
          if (!sameValue(value, before[column as keyof typeof before])) {
            (changes as Record<string, unknown>)[column] = value;
          }
        }
        // Only when the switch was moved, and once the saved value is known (a failed load must not
        // silently unpublish). Switched on without a paid period it stays off until paid; the
        // listing date is stamped only when the unit newly goes on the market.
        if (!isOwner && !lock.details && saved && form.market_listed !== shownListed) {
          if (listed) {
            changes.market_listed = true;
            if (!saved.market_listed) changes.market_listed_at = new Date().toISOString();
          } else if (!form.market_listed) {
            changes.market_listed = false;
          }
        }
        if (Object.keys(changes).length > 0) {
          const { data, error } = await supabase
            .from("units")
            .update(changes)
            .eq("id", unitId)
            .select("id");
          if (error) throw error;
          if (!data?.length) {
            throw new Error("لم تُحفظ التعديلات — ليست لديك صلاحية تعديل هذه الوحدة");
          }
        }
      } else {
        const { data, error } = await supabase
          .from("units")
          .insert({
            ...row,
            property_id: propertyId,
            ...(isOwner
              ? {}
              : {
                  market_listed: listed,
                  ...(listed ? { market_listed_at: new Date().toISOString() } : {}),
                }),
          })
          .select("id")
          .single();
        if (error) throw error;
        unitId = data.id;
        // From here on a retry updates this unit instead of creating a second one.
        setForm((f) => ({ ...f, id: data.id }));
      }
      // Don't touch the photos of a unit whose saved photos never loaded (that would delete them).
      if (!isOwner && !lock.details && (!form.id || savedPhotos.data)) {
        await syncUnitPhotos(supabase, unitId, savedPhotos.data ?? [], photoItems);
        queryClient.invalidateQueries({ queryKey: ["unit-photos", unitId] });
      }
      if (!needsPayment) return null;
      // The unit is saved either way; a payment that cannot start is reported, not a failed save.
      try {
        return await startPayment({ data: { unitId } });
      } catch (e) {
        return { status: "error" as const, message: userErrorMessage(e, "تعذّر فتح صفحة الدفع") };
      }
    },
    onSuccess: (payment) => {
      toast.success(isEdit ? "تم تحديث الوحدة" : "تمت إضافة الوحدة");
      if (payment?.status === "error") toast.error(payment.message);
      if (payment?.status === "paid") toast.success("تم نشر الوحدة في الموقع");
      if (payment?.status === "pending" && isMoyasarCheckoutUrl(payment.url)) {
        toast.info("جارٍ تحويلك إلى صفحة الدفع…");
        window.location.assign(payment.url);
      }
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      queryClient.invalidateQueries({ queryKey: ["owner-own-properties"] });
      queryClient.invalidateQueries({ queryKey: ["owner-agreements-properties"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      queryClient.invalidateQueries({ queryKey: ["unit-listing-fields", form.id] });
      queryClient.invalidateQueries({ queryKey: ["property-unit-numbers", propertyId] });
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
          {locks?.note ? <p className="text-xs text-muted-foreground">{locks.note}</p> : null}
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="رقم الشقة / الوحدة" error={errors.unit_number}>
            <Input
              value={form.unit_number}
              onChange={(e) => set("unit_number", e.target.value)}
              placeholder="مثال: 12"
              aria-invalid={Boolean(errors.unit_number)}
              disabled={lock.details}
            />
          </Field>
          <Field label="اسم الوحدة (اختياري)">
            <Input
              value={form.unit_name}
              onChange={(e) => set("unit_name", e.target.value)}
              placeholder="مثال: شقة الياسمين"
              disabled={lock.details}
            />
          </Field>
          <Field label="النوع">
            <Select
              value={form.unit_type}
              onValueChange={(v) => set("unit_type", v)}
              disabled={lock.details}
            >
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
              disabled={lock.details}
            />
          </Field>
          <Field label="الحي">
            <Input
              value={form.district}
              onChange={(e) => set("district", e.target.value)}
              disabled={lock.details}
            />
          </Field>
          <Field label="الشارع">
            <Input
              value={form.street}
              onChange={(e) => set("street", e.target.value)}
              disabled={lock.details}
            />
          </Field>
          <Field label="عدد الغرف" error={errors.rooms}>
            <Input
              inputMode="numeric"
              value={form.rooms}
              onChange={(e) => set("rooms", e.target.value)}
              aria-invalid={Boolean(errors.rooms)}
              disabled={lock.details}
            />
          </Field>
          <Field label="عدد الصالات" error={errors.halls}>
            <Input
              inputMode="numeric"
              value={form.halls}
              onChange={(e) => set("halls", e.target.value)}
              aria-invalid={Boolean(errors.halls)}
              disabled={lock.details}
            />
          </Field>
          <Field label="عدد الحمامات" error={errors.bathrooms}>
            <Input
              inputMode="numeric"
              value={form.bathrooms}
              onChange={(e) => set("bathrooms", e.target.value)}
              aria-invalid={Boolean(errors.bathrooms)}
              disabled={lock.details}
            />
          </Field>
          <Field label="المساحة (م²)" error={errors.area}>
            <Input
              inputMode="decimal"
              value={form.area}
              onChange={(e) => set("area", e.target.value)}
              aria-invalid={Boolean(errors.area)}
              disabled={lock.details}
            />
          </Field>
          <Field label="رقم صك الوحدة" error={errors.deed_number}>
            <Input
              dir="ltr"
              value={form.deed_number}
              onChange={(e) => set("deed_number", e.target.value)}
              placeholder="إن كان للوحدة صك مستقل"
              aria-invalid={Boolean(errors.deed_number)}
              disabled={lock.deed}
            />
            {deedState === "same_property" && !errors.deed_number ? (
              <p className="text-xs text-warning">
                رقم الصك نفسه مسجّل لوحدة أخرى في هذا العقار — احفظ فقط إن كان الصك يشمل الوحدتين.
              </p>
            ) : null}
          </Field>
          <Field label="نوع العرض">
            <Select
              value={form.listing_purpose}
              onValueChange={(v) => set("listing_purpose", v as ListingPurpose)}
              disabled={lock.details}
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
                  disabled={lock.rent || lock.details}
                />
              </Field>
              {isOwner ? null : (
                <Field label="حالة البيع">
                  <Select
                    value={form.status === "sold" ? "sold" : "vacant"}
                    onValueChange={(v) => set("status", v)}
                    disabled={lock.details}
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
                disabled={lock.rent}
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
                    disabled={lock.details}
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
                    disabled={lock.details}
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
                  disabled={suggest.isPending || lock.rent}
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
              disabled={lock.details}
            />
          </Field>
          <Field label="رقم عداد المياه">
            <Input
              dir="ltr"
              value={form.water_meter_no}
              onChange={(e) => set("water_meter_no", e.target.value)}
              disabled={lock.details}
            />
          </Field>
          <div className="rounded-lg border border-border p-4 sm:col-span-2">
            <FurnitureEditor
              furnishing={form.furnishing}
              items={form.furniture}
              notes={form.furniture_notes}
              disabled={!canManage || save.isPending || lock.deed}
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
                <Select
                  value={form.owner_id}
                  onValueChange={(v) => set("owner_id", v)}
                  disabled={ownerFixed}
                >
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
                      تظهر الوحدة للجميع في سوق العروض عندما تكون شاغرة ويكون «إظهار المكتب في دليل
                      المكاتب» مفعّلًا في هوية المكتب ومعتمدًا من المنصة.
                    </p>
                    <p className="mt-1 text-xs font-medium">
                      {market.kind === "paid"
                        ? `النشر مدفوع حتى ${shortDate(market.until.toISOString())}`
                        : market.kind === "free"
                          ? "منشورة مجانًا — إن أوقفت نشرها فإعادة النشر برسوم."
                          : `رسوم النشر ${LISTING_FEE_LABEL} شاملة الضريبة — بعد الحفظ تنتقل لصفحة الدفع.`}
                    </p>
                  </div>
                  <Switch
                    id="market_listed"
                    checked={form.market_listed}
                    disabled={lock.details || (isEdit && !listingFields.data)}
                    onCheckedChange={(v) => set("market_listed", v)}
                  />
                </div>
                <Field label="صور الوحدة">
                  <UnitPhotosEditor
                    items={photoItems}
                    onChange={setPhotoItems}
                    disabled={
                      !canManage ||
                      save.isPending ||
                      lock.details ||
                      (isEdit && savedPhotos.isLoading)
                    }
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
                disabled={lock.advert}
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
                      disabled={lock.advert}
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
                      } disabled:cursor-not-allowed disabled:opacity-50`}
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
                disabled={lock.advert}
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
            {needsPayment ? " والدفع للنشر" : ""}
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
