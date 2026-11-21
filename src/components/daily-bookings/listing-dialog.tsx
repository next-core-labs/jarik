import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UnitPhotosEditor } from "@/components/unit-photos-editor";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { userErrorMessage } from "@/lib/auth-errors";
import {
  bookingBlockers,
  bookingDirty,
  bookingFromRow,
  bookingToRow,
  emptyBooking,
  type BookingForm,
} from "@/lib/booking-settings";
import { groupOfType } from "@/lib/property-types";
import { parseAmount } from "@/lib/public-form";
import { toLatinDigits } from "@/lib/saudi-id";
import { mediaUrl, syncUnitPhotos, type ExistingPhoto, type PhotoItem } from "@/lib/unit-photos";

import { BOOKINGS_KEY, LISTINGS_KEY, type DailyListing } from "./model";

/**
 * إعلان حجز يومي — يُنشأ ويُعدَّل من لوحة الحجز اليومي نفسها، بلا مرور بشاشات الإيجار السنوي:
 * لا إيجار سنوي، لا عقد، لا عدّادات. ما يحتاجه الضيف فقط: المكان، الصور، سعر الليلة، ورخصة
 * الإيواء السياحي التي يُلزم بها النظام.
 *
 * في القاعدة الإعلان وحدة تحت عقار خاص بها (الحجوزات والصور وصفحة العرض العامة كلها مبنية على
 * الوحدة)، لكنها وحدة بلا إيجار سنوي ولا سعر بيع، فلا تظهر في سوق الإيجار ولا في شاشاته
 * (isDailyOnly).
 */

const DAILY_TYPES = [
  "شاليه",
  "استراحة",
  "مخيم",
  "مزرعة",
  "فيلا",
  "شقة",
  "استوديو",
  "دور",
  "دوبلكس",
  "غرفة",
];

const DAILY_AMENITIES = [
  "مسبح",
  "جلسة خارجية",
  "ركن شواء",
  "ألعاب أطفال",
  "ملعب",
  "مطبخ راكب",
  "مكيفات راكبة",
  "إنترنت / ألياف",
  "موقف سيارات",
  "مدخل خاص",
  "كاميرات مراقبة",
];

type Details = {
  name: string;
  unit_type: string;
  city: string;
  district: string;
  rooms: string;
  bathrooms: string;
  area: string;
  description: string;
  amenities: string[];
};

const emptyDetails: Details = {
  name: "",
  unit_type: "شاليه",
  city: "",
  district: "",
  rooms: "",
  bathrooms: "",
  area: "",
  description: "",
  amenities: [],
};

const detailsFrom = (l: DailyListing): Details => ({
  name: l.unit_name ?? "",
  unit_type: l.unit_type,
  city: l.property?.city ?? "",
  district: l.district ?? l.property?.district ?? "",
  rooms: l.rooms == null ? "" : String(l.rooms),
  bathrooms: l.bathrooms ? String(l.bathrooms) : "",
  area: l.area == null ? "" : String(l.area),
  description: l.listing_description ?? "",
  amenities: l.amenities,
});

const digitsOnly = (v: string) => toLatinDigits(v).replace(/[^\d]/g, "");

/** عدد صحيح ضمن حدّ، أو null للفارغ؛ `false` لما كُتب خطأً. */
function whole(v: string, max: number): number | null | false {
  const n = parseAmount(v);
  if (n === undefined) return null;
  if (n === null || !Number.isInteger(n) || n < 0 || n > max) return false;
  return n;
}

function unitColumns(d: Details) {
  const rooms = whole(d.rooms, 50);
  const bathrooms = whole(d.bathrooms, 20);
  const area = parseAmount(d.area);
  return {
    unit_name: d.name.trim(),
    unit_type: d.unit_type,
    district: d.district.trim() || null,
    rooms: rooms === false ? null : rooms,
    bathrooms: bathrooms === false || bathrooms === null ? 0 : bathrooms,
    area: area && area > 0 ? area : null,
    listing_description: d.description.trim() || null,
    amenities: d.amenities,
  };
}

export function DailyListingDialog({
  open,
  onOpenChange,
  listing,
  /** رقم رخصة آخر إعلان — يُقترح في الإعلان الجديد، فالمكتب لا يعيد كتابته لكل وحدة. */
  suggestedLicense,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listing: DailyListing | null;
  suggestedLicense?: string | undefined;
}) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(listing);
  // وحدة تُؤجَّر سنويًا أيضًا: مواصفاتها وصورها تخصّ شاشة الوحدات؛ هنا إعدادات الحجز فقط.
  const editsUnit = !listing || listing.dailyOnly;
  const editsPlace =
    !listing ||
    (listing.dailyOnly &&
      Boolean(listing.property?.ownedByOffice) &&
      listing.property?.structure === "single");

  const [details, setDetails] = useState<Details>(emptyDetails);
  const [booking, setBooking] = useState<BookingForm>(emptyBooking);
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([]);
  // ما أُنشئ في محاولة فشلت في منتصفها: إعادة المحاولة تكمل عليه ولا تنشئ عقارًا ووحدة ثانيين.
  const created = useRef<{ propertyId?: string; unitId?: string }>({});
  const photosLoaded = useRef(false);

  const savedPhotos = useQuery({
    queryKey: ["unit-photos", listing?.unit_id],
    enabled: open && Boolean(listing) && editsUnit,
    queryFn: async (): Promise<ExistingPhoto[]> => {
      const { data, error } = await supabase
        .from("unit_photos")
        .select("id, path, position")
        .eq("unit_id", listing!.unit_id)
        .order("position");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!open) return;
    created.current = {};
    photosLoaded.current = false;
    setPhotoItems([]);
    if (listing) {
      setDetails(detailsFrom(listing));
      setBooking(bookingFromRow(listing.settings));
    } else {
      setDetails(emptyDetails);
      setBooking({
        ...emptyBooking,
        enabled: true,
        tourism_license_no: suggestedLicense ?? "",
      });
    }
    // يُعاد الضبط عند الفتح فقط: تحديث القائمة في الخلفية لا يمسح ما يكتبه المكتب الآن.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listing?.unit_id]);

  useEffect(() => {
    if (!open || photosLoaded.current || !savedPhotos.data) return;
    photosLoaded.current = true;
    setPhotoItems(
      savedPhotos.data.map((p) => ({
        key: p.id,
        id: p.id,
        path: p.path,
        file: null,
        preview: mediaUrl(p.path),
      })),
    );
  }, [open, savedPhotos.data]);

  const setD = <K extends keyof Details>(key: K, value: Details[K]) =>
    setDetails((d) => ({ ...d, [key]: value }));
  const setB = <K extends keyof BookingForm>(key: K, value: BookingForm[K]) =>
    setBooking((b) => ({ ...b, [key]: value }));

  const area = parseAmount(details.area);
  const errors = {
    name: editsUnit && details.name.trim().length < 2 ? "اكتب اسم الإعلان" : null,
    city: editsPlace && !details.city.trim() ? "اكتب المدينة" : null,
    rooms: editsUnit && whole(details.rooms, 50) === false ? "عدد الغرف رقم صحيح" : null,
    bathrooms:
      editsUnit && whole(details.bathrooms, 20) === false ? "عدد دورات المياه رقم صحيح" : null,
    area: editsUnit && (area === null || area === 0) ? "المساحة رقم بالمتر المربع" : null,
  };
  // إعلان منشور بسعر أو رخصة ناقصة يُحفظ ثم لا يظهر في /stays ولا يقول لماذا — فالمنع هنا.
  const bookingNeeds = booking.enabled ? bookingBlockers(booking) : [];
  const formError = Object.values(errors).find((e) => e !== null) ?? bookingNeeds[0] ?? null;
  const types = DAILY_TYPES.includes(details.unit_type)
    ? DAILY_TYPES
    : [details.unit_type, ...DAILY_TYPES];
  const amenityOptions = [
    ...DAILY_AMENITIES,
    ...details.amenities.filter((a) => !DAILY_AMENITIES.includes(a)),
  ];

  const save = useMutation({
    mutationFn: async () => {
      if (formError) throw new Error(formError);
      const columns = unitColumns(details);
      let unitId = listing?.unit_id ?? created.current.unitId;

      if (!unitId) {
        // 1) عقار خاص بالإعلان (مكتبه يملؤه a_fill_org)، 2) وحدته — بلا إيجار سنوي ولا سعر بيع.
        let propertyId = created.current.propertyId;
        if (!propertyId) {
          const { data, error } = await supabase
            .from("properties")
            .insert({
              name: columns.unit_name,
              structure: "single",
              property_type: groupOfType(columns.unit_type),
              city: details.city.trim() || null,
              district: columns.district,
            })
            .select("id")
            .single();
          if (error) throw error;
          propertyId = data.id;
          created.current.propertyId = propertyId;
        }
        const { data, error } = await supabase
          .from("units")
          .insert({ ...columns, property_id: propertyId, unit_number: "1", furnishing: "full" })
          .select("id")
          .single();
        if (error) throw error;
        unitId = data.id;
        created.current.unitId = unitId;
      } else if (listing && editsUnit) {
        const before = unitColumns(detailsFrom(listing));
        const changes: TablesUpdate<"units"> = {};
        for (const [column, value] of Object.entries(columns)) {
          if (JSON.stringify(value) !== JSON.stringify(before[column as keyof typeof before])) {
            (changes as Record<string, unknown>)[column] = value;
          }
        }
        if (Object.keys(changes).length > 0) {
          const { data, error } = await supabase
            .from("units")
            .update(changes)
            .eq("id", unitId)
            .select("id");
          if (error) throw error;
          if (!data?.length) throw new Error("لم تُحفظ التعديلات — ليست لديك صلاحية تعديل الإعلان");
        }
        if (editsPlace && listing.property) {
          const place: TablesUpdate<"properties"> = {};
          if (columns.unit_name !== listing.property.name) place.name = columns.unit_name;
          if ((details.city.trim() || null) !== listing.property.city) {
            place.city = details.city.trim() || null;
          }
          if (columns.district !== listing.property.district) place.district = columns.district;
          if (Object.keys(place).length > 0) {
            const { error } = await supabase
              .from("properties")
              .update(place)
              .eq("id", listing.property.id);
            if (error) throw error;
          }
        }
      }

      if (!listing || bookingDirty(booking, listing.settings)) {
        const { error } = await supabase
          .from("unit_booking_settings")
          .upsert(bookingToRow(unitId, booking), { onConflict: "unit_id" });
        if (error) throw error;
      }

      // لا تُمسّ صور إعلان لم تُحمَّل صوره المحفوظة (كان ذلك سيحذفها).
      if (editsUnit && (!listing || savedPhotos.data)) {
        await syncUnitPhotos(supabase, unitId, savedPhotos.data ?? [], photoItems);
      }

      // النشر آخرًا: حرس النشر يشترط سعر ليلة محفوظًا (guard_market_publish). ووحدة تُؤجَّر سنويًا
      // أيضًا لا تُنشر من هنا — نشرها يضعها في سوق الإيجار كذلك، وذاك قرار شاشة الوحدات.
      if (booking.enabled && editsUnit && !(listing?.market_listed ?? false)) {
        const { error } = await supabase
          .from("units")
          .update({ market_listed: true, market_listed_at: new Date().toISOString() })
          .eq("id", unitId);
        if (error) throw error;
      }
      return unitId;
    },
    onSuccess: (unitId) => {
      toast.success(isEdit ? "تم تحديث الإعلان" : "أُضيف الإعلان إلى الحجز اليومي");
      queryClient.invalidateQueries({ queryKey: LISTINGS_KEY });
      queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
      queryClient.invalidateQueries({ queryKey: ["unit-photos", unitId] });
      queryClient.invalidateQueries({ queryKey: ["unit-booking-settings", unitId] });
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      // ما أُنشئ قبل الفشل يبقى ظاهرًا في القائمة (كإعلان ناقص) ولو أُغلقت النافذة.
      if (created.current.unitId) queryClient.invalidateQueries({ queryKey: LISTINGS_KEY });
      toast.error(userErrorMessage(e, "تعذّر حفظ الإعلان"));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isEdit ? "تعديل إعلان الحجز اليومي" : "إعلان حجز يومي جديد"}
          </DialogTitle>
          <DialogDescription>
            {editsUnit
              ? "شاليه أو استراحة أو وحدة مفروشة تُحجز بالليلة — مستقل عن الإيجار السنوي وعقوده."
              : `${listing?.property?.name ?? ""} — هذه الوحدة تُؤجَّر سنويًا أيضًا؛ مواصفاتها وصورها من «الأملاك والوحدات»، وهنا إعدادات حجزها اليومي.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          {editsUnit ? (
            <section className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold">الإعلان</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="اسم الإعلان" error={details.name ? errors.name : null}>
                  <Input
                    value={details.name}
                    onChange={(e) => setD("name", e.target.value)}
                    maxLength={80}
                    placeholder="شاليه النخيل"
                  />
                </Field>
                <Field label="النوع">
                  <Select value={details.unit_type} onValueChange={(v) => setD("unit_type", v)}>
                    <SelectTrigger aria-label="النوع">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {types.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="المدينة">
                  <Input
                    value={details.city}
                    onChange={(e) => setD("city", e.target.value)}
                    disabled={!editsPlace}
                    maxLength={60}
                    placeholder="الرياض"
                  />
                </Field>
                <Field label="الحي">
                  <Input
                    value={details.district}
                    onChange={(e) => setD("district", e.target.value)}
                    maxLength={80}
                    placeholder="العمارية"
                  />
                </Field>
                <Field label="الغرف" error={errors.rooms}>
                  <Input
                    value={details.rooms}
                    onChange={(e) => setD("rooms", digitsOnly(e.target.value))}
                    inputMode="numeric"
                    maxLength={2}
                  />
                </Field>
                <Field label="دورات المياه" error={errors.bathrooms}>
                  <Input
                    value={details.bathrooms}
                    onChange={(e) => setD("bathrooms", digitsOnly(e.target.value))}
                    inputMode="numeric"
                    maxLength={2}
                  />
                </Field>
                <Field label="المساحة (م²) — اختياري" error={errors.area}>
                  <Input
                    value={details.area}
                    onChange={(e) => setD("area", e.target.value)}
                    inputMode="decimal"
                    maxLength={8}
                  />
                </Field>
              </div>
              <Field label="وصف الإعلان">
                <Textarea
                  value={details.description}
                  onChange={(e) => setD("description", e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="ما يميّز المكان: المسبح، الجلسات، القرب من الطريق…"
                />
              </Field>
              <Field label="المزايا">
                <div className="flex flex-wrap gap-2">
                  {amenityOptions.map((a) => {
                    const on = details.amenities.includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setD(
                            "amenities",
                            on
                              ? details.amenities.filter((x) => x !== a)
                              : [...details.amenities, a],
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
              <Field label="الصور">
                <UnitPhotosEditor
                  items={photoItems}
                  onChange={setPhotoItems}
                  disabled={isEdit && savedPhotos.isLoading}
                  hint="الصورة الأولى غلاف الإعلان في سوق الحجز اليومي. "
                />
              </Field>
            </section>
          ) : null}

          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold">الترخيص</h3>
            <Field label="رقم رخصة الإيواء السياحي (وزارة السياحة)">
              <Input
                value={booking.tourism_license_no}
                onChange={(e) => setB("tourism_license_no", e.target.value)}
                dir="ltr"
                maxLength={40}
                placeholder="TL-000000"
                aria-invalid={booking.enabled && !booking.tourism_license_no.trim()}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              النظام يُلزم برخصة إيواء سياحي للتأجير اليومي؛ يظهر رقمها للضيف في صفحة الإعلان، ولا
              يُنشر إعلان بدونها.
            </p>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold">السعر وشروط الحجز</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="سعر الليلة — أيام الأسبوع (ر.س)">
                <Input
                  value={booking.nightly_rate}
                  onChange={(e) => setB("nightly_rate", e.target.value)}
                  inputMode="numeric"
                  placeholder="1500"
                />
              </Field>
              <Field label="سعر ليلة نهاية الأسبوع (الخميس والجمعة)">
                <Input
                  value={booking.weekend_rate}
                  onChange={(e) => setB("weekend_rate", e.target.value)}
                  inputMode="numeric"
                  placeholder="يساوي سعر الأسبوع إن تُرك فارغًا"
                />
              </Field>
              <Field label="أقل مدة حجز (ليالٍ)">
                <Input
                  value={booking.min_nights}
                  onChange={(e) => setB("min_nights", digitsOnly(e.target.value))}
                  inputMode="numeric"
                  maxLength={2}
                />
              </Field>
              <Field label="أقصى عدد ضيوف">
                <Input
                  value={booking.max_guests}
                  onChange={(e) => setB("max_guests", digitsOnly(e.target.value))}
                  inputMode="numeric"
                  maxLength={3}
                />
              </Field>
              <Field label="وقت الدخول">
                <Input
                  type="time"
                  value={booking.checkin_time}
                  onChange={(e) => setB("checkin_time", e.target.value)}
                />
              </Field>
              <Field label="وقت الخروج">
                <Input
                  type="time"
                  value={booking.checkout_time}
                  onChange={(e) => setB("checkout_time", e.target.value)}
                />
              </Field>
              <Field label="إلغاء مجاني حتى (أيام قبل الدخول)">
                <Input
                  value={booking.free_cancel_days}
                  onChange={(e) => setB("free_cancel_days", digitsOnly(e.target.value))}
                  inputMode="numeric"
                  maxLength={2}
                />
              </Field>
            </div>
            <Field label="شروط المكان">
              <Textarea
                value={booking.house_rules}
                onChange={(e) => setB("house_rules", e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="للعائلات فقط، يُمنع التدخين داخل المكان…"
              />
            </Field>
          </section>

          <div className="flex items-start justify-between gap-4 rounded-sm border border-border px-4 py-3">
            <div>
              <Label htmlFor="daily_listing_enabled" className="text-sm font-semibold">
                استقبال الحجوزات
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                أطفئه لإيقاف الإعلان مؤقتًا: يختفي من سوق الحجز اليومي وتبقى حجوزاته وبياناته.
              </p>
            </div>
            <Switch
              id="daily_listing_enabled"
              checked={booking.enabled}
              onCheckedChange={(v) => setB("enabled", v)}
            />
          </div>

          {bookingNeeds.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-sm border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              <p className="font-semibold">أكمل هذه ليُحفظ الإعلان — أو أطفئ استقبال الحجوزات:</p>
              <ul className="flex flex-col gap-1">
                {bookingNeeds.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              Boolean(formError) ||
              save.isPending ||
              // لا يُحفظ فوق الصور قبل أن تُحمَّل
              (isEdit && editsUnit && savedPhotos.isLoading)
            }
          >
            {save.isPending ? "جارٍ الحفظ…" : isEdit ? "حفظ التعديلات" : "إضافة الإعلان"}
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
  error?: string | null | undefined;
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
