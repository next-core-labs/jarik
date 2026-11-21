import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { BookingSettingsRow } from "@/lib/booking-settings";
import { isDailyOnly } from "@/lib/daily-listings";

/** بيانات لوحة الحجز اليومي: الحجوزات والإعلانات. RLS تحصرها في مكتب الموظف. */

export type BookingRow = {
  id: string;
  unit_id: string;
  guest_name: string | null;
  guest_phone: string | null;
  guests: number | null;
  /** `stay` يأتي من PostgREST نصًّا (`[2026-12-01,2026-12-04)`)، فيُفكّ مرة واحدة عند القراءة. */
  from_date: string;
  to_date: string;
  nights: number;
  total_amount: number;
  status: string;
  notes: string | null;
  staff_note: string | null;
  created_at: string;
  unit_label: string;
};

/** daterange من PostgREST يأتي نصًّا: `[2026-12-01,2026-12-04)`. */
export function parseStay(stay: string): { from: string; to: string } {
  const m = /^\[?"?(\d{4}-\d{2}-\d{2})"?,"?(\d{4}-\d{2}-\d{2})"?\)?$/.exec(stay.trim());
  return { from: m?.[1] ?? "", to: m?.[2] ?? "" };
}

export const unitLabel = (
  u: { unit_name: string | null; unit_number: string | null } | null | undefined,
) => u?.unit_name?.trim() || `وحدة ${u?.unit_number ?? "—"}`;

export const BOOKINGS_KEY = ["office-bookings"] as const;
export const LISTINGS_KEY = ["office-daily-listings"] as const;

export function useOfficeBookings() {
  return useQuery({
    queryKey: BOOKINGS_KEY,
    queryFn: async (): Promise<BookingRow[]> => {
      const { data, error } = await supabase
        .from("bookings")
        .select(
          "id, unit_id, guest_name, guest_phone, guests, stay, nights, total_amount, status, notes, staff_note, created_at, units(unit_number, unit_name)",
        )
        .order("created_at", { ascending: false })
        // قائمة العملاء تُبنى من هذه الصفوف، فالسقف أعلى مما تحتاجه قائمة الطلبات وحدها.
        .limit(1000);
      if (error) throw error;
      return (data ?? []).map((b) => {
        const { from, to } = parseStay(String(b.stay ?? ""));
        return {
          id: b.id,
          unit_id: b.unit_id,
          guest_name: b.guest_name,
          guest_phone: b.guest_phone,
          guests: b.guests,
          from_date: from,
          to_date: to,
          nights: b.nights,
          total_amount: Number(b.total_amount),
          status: b.status,
          notes: b.notes,
          staff_note: b.staff_note,
          created_at: b.created_at,
          unit_label: unitLabel(b.units),
        };
      });
    },
  });
}

export type DailyListing = {
  unit_id: string;
  settings: BookingSettingsRow;
  unit_number: string;
  unit_name: string | null;
  unit_type: string;
  district: string | null;
  rooms: number | null;
  bathrooms: number;
  area: number | null;
  listing_description: string | null;
  amenities: string[];
  status: string;
  market_listed: boolean;
  /** إعلان حجز يومي فقط، أم وحدة تُؤجَّر سنويًا أيضًا (تُدار مواصفاتها من «الأملاك والوحدات»). */
  dailyOnly: boolean;
  property: {
    id: string;
    name: string;
    city: string | null;
    district: string | null;
    structure: string;
    /** عقار مسجَّل للمكتب نفسه — لا عقار مالك يُدار باتفاقية. */
    ownedByOffice: boolean;
  } | null;
  /** ظاهر الآن في سوق الحجز اليومي (bookable_units_public). */
  live: boolean;
  cover_path: string | null;
};

export function useDailyListings() {
  return useQuery({
    queryKey: LISTINGS_KEY,
    queryFn: async (): Promise<DailyListing[]> => {
      const { data, error } = await supabase
        .from("unit_booking_settings")
        .select(
          "unit_id, enabled, nightly_rate, weekend_rate, min_nights, max_guests, checkin_time, checkout_time, tourism_license_no, free_cancel_days, house_rules, created_at, units(unit_number, unit_name, unit_type, district, rooms, bathrooms, area, listing_description, amenities, status, market_listed, annual_rent, sale_price, properties(id, name, city, district, structure, org_id))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).filter((r) => r.units);
      const ids = rows.map((r) => r.unit_id);
      if (ids.length === 0) return [];

      // مصدر الحقيقة لـ«منشور»: العرض العام نفسه، لا إعادة اشتقاق شروطه هنا.
      const [live, photos] = await Promise.all([
        supabase.from("bookable_units_public").select("id").in("id", ids),
        supabase
          .from("unit_photos")
          .select("unit_id, path, position")
          .in("unit_id", ids)
          .order("position"),
      ]);
      if (live.error) throw live.error;
      const liveIds = new Set((live.data ?? []).map((r) => r.id));
      const cover = new Map<string, string>();
      for (const p of photos.data ?? []) if (!cover.has(p.unit_id)) cover.set(p.unit_id, p.path);

      return rows.map((r) => {
        const u = r.units!;
        const p = u.properties;
        return {
          unit_id: r.unit_id,
          settings: {
            unit_id: r.unit_id,
            enabled: r.enabled,
            nightly_rate: r.nightly_rate,
            weekend_rate: r.weekend_rate,
            min_nights: r.min_nights,
            max_guests: r.max_guests,
            checkin_time: r.checkin_time,
            checkout_time: r.checkout_time,
            tourism_license_no: r.tourism_license_no,
            free_cancel_days: r.free_cancel_days,
            house_rules: r.house_rules,
          },
          unit_number: u.unit_number,
          unit_name: u.unit_name,
          unit_type: u.unit_type,
          district: u.district,
          rooms: u.rooms,
          bathrooms: u.bathrooms,
          area: u.area,
          listing_description: u.listing_description,
          amenities: u.amenities ?? [],
          status: u.status,
          market_listed: u.market_listed,
          dailyOnly: isDailyOnly({
            annual_rent: u.annual_rent,
            sale_price: u.sale_price,
            hasBookingSettings: true,
          }),
          property: p
            ? {
                id: p.id,
                name: p.name,
                city: p.city,
                district: p.district,
                structure: p.structure,
                ownedByOffice: p.org_id != null,
              }
            : null,
          live: liveIds.has(r.unit_id),
          cover_path: cover.get(r.unit_id) ?? null,
        };
      });
    },
  });
}
