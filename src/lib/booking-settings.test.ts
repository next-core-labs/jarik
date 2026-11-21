import { describe, expect, it } from "vitest";

import {
  bookingBlockers,
  bookingDirty,
  bookingFromRow,
  bookingToRow,
  emptyBooking,
  type BookingSettingsRow,
} from "./booking-settings";

const row = (over: Partial<BookingSettingsRow> = {}): BookingSettingsRow => ({
  unit_id: "11111111-1111-4111-8111-111111111111",
  enabled: true,
  nightly_rate: 1500,
  weekend_rate: 2500,
  min_nights: 2,
  max_guests: 12,
  checkin_time: "16:00:00",
  checkout_time: "12:00:00",
  tourism_license_no: "TL-123",
  free_cancel_days: 3,
  house_rules: "ممنوع التدخين",
  ...over,
});

describe("bookingFromRow", () => {
  it("reads a saved row into the form", () => {
    const f = bookingFromRow(row());
    expect(f.enabled).toBe(true);
    expect(f.nightly_rate).toBe("1500");
    expect(f.weekend_rate).toBe("2500");
    expect(f.tourism_license_no).toBe("TL-123");
  });

  it("trims Postgres time to what <input type=time> accepts", () => {
    expect(bookingFromRow(row()).checkin_time).toBe("16:00");
    // وقت تالف لا يُفرِّغ الحقل بل يرجع للافتراضي.
    expect(bookingFromRow(row({ checkin_time: "junk" })).checkin_time).toBe("16:00");
  });

  it("treats a missing row as «booking off», not an error", () => {
    expect(bookingFromRow(null)).toEqual(emptyBooking);
  });
});

describe("bookingToRow", () => {
  it("converts the typed strings to numbers", () => {
    const r = bookingToRow("u1", bookingFromRow(row()));
    expect(r).toMatchObject({
      unit_id: "u1",
      enabled: true,
      nightly_rate: 1500,
      weekend_rate: 2500,
      min_nights: 2,
      max_guests: 12,
      checkin_time: "16:00",
      checkout_time: "12:00",
      tourism_license_no: "TL-123",
    });
  });

  it("sends null for an empty optional, never 0 or an empty string", () => {
    const r = bookingToRow("u1", { ...emptyBooking, enabled: true });
    expect(r.nightly_rate).toBeNull();
    expect(r.weekend_rate).toBeNull();
    expect(r.max_guests).toBeNull();
    expect(r.house_rules).toBeNull();
    expect(r.tourism_license_no).toBeNull();
  });

  it("clamps min_nights and free_cancel_days into what the CHECK constraints accept", () => {
    const high = bookingToRow("u1", {
      ...emptyBooking,
      min_nights: "999",
      free_cancel_days: "900",
    });
    expect(high.min_nights).toBe(90);
    expect(high.free_cancel_days).toBe(60);
    const low = bookingToRow("u1", { ...emptyBooking, min_nights: "0", free_cancel_days: "" });
    expect(low.min_nights).toBe(1);
    expect(low.free_cancel_days).toBe(0);
  });

  it("drops a zero or negative price — the database rejects it anyway", () => {
    expect(bookingToRow("u1", { ...emptyBooking, nightly_rate: "0" }).nightly_rate).toBeNull();
    expect(bookingToRow("u1", { ...emptyBooking, nightly_rate: "-5" }).nightly_rate).toBeNull();
  });

  // الخلل الذي اختفت به وحدة حقيقية من /stays: السعر كُتب، والقارئ لاتيني بحت فحُفظ فراغًا.
  it("reads a price typed on an Arabic keyboard, and thousands separators", () => {
    expect(bookingToRow("u1", { ...emptyBooking, nightly_rate: "١٥٠٠" }).nightly_rate).toBe(1500);
    expect(bookingToRow("u1", { ...emptyBooking, nightly_rate: "1,500" }).nightly_rate).toBe(1500);
    expect(bookingToRow("u1", { ...emptyBooking, nightly_rate: "١٬٥٠٠" }).nightly_rate).toBe(1500);
    expect(bookingToRow("u1", { ...emptyBooking, weekend_rate: "٢٥٠٠" }).weekend_rate).toBe(2500);
    expect(bookingToRow("u1", { ...emptyBooking, max_guests: "١٢" }).max_guests).toBe(12);
    expect(bookingToRow("u1", { ...emptyBooking, min_nights: "٣" }).min_nights).toBe(3);
    expect(bookingToRow("u1", { ...emptyBooking, free_cancel_days: "٧" }).free_cancel_days).toBe(7);
  });

  it("still refuses text, so a typo is never saved as a price", () => {
    expect(
      bookingToRow("u1", { ...emptyBooking, nightly_rate: "1500ر.س" }).nightly_rate,
    ).toBeNull();
    expect(bookingToRow("u1", { ...emptyBooking, nightly_rate: "غالي" }).nightly_rate).toBeNull();
  });
});

describe("bookingDirty", () => {
  it("is false when nothing was touched — saving a unit must not rewrite booking settings", () => {
    expect(bookingDirty(bookingFromRow(row()), row())).toBe(false);
    expect(bookingDirty(emptyBooking, null)).toBe(false);
  });

  it("is true for a real change", () => {
    const f = bookingFromRow(row());
    expect(bookingDirty({ ...f, nightly_rate: "1600" }, row())).toBe(true);
    expect(bookingDirty({ ...f, enabled: false }, row())).toBe(true);
  });

  it("ignores formatting that converts to the same value", () => {
    const f = bookingFromRow(row());
    expect(bookingDirty({ ...f, nightly_rate: "1500 " }, row())).toBe(false);
  });

  it("sees turning booking on for a unit that never had settings", () => {
    expect(bookingDirty({ ...emptyBooking, enabled: true }, null)).toBe(true);
  });
});

describe("bookingBlockers", () => {
  it("is empty once the unit really can be shown", () => {
    expect(bookingBlockers(bookingFromRow(row()))).toEqual([]);
  });

  it("asks for the nightly rate and the tourism licence the system requires", () => {
    const blockers = bookingBlockers({ ...emptyBooking, enabled: true });
    expect(blockers).toHaveLength(2);
    expect(blockers.join(" ")).toContain("سعر الليلة");
    expect(blockers.join(" ")).toContain("رخصة الإيواء السياحي");
  });

  it("accepts an Arabic-typed price instead of asking for one that is already there", () => {
    const f = { ...emptyBooking, enabled: true, nightly_rate: "١٥٠٠", tourism_license_no: "TL-9" };
    expect(bookingBlockers(f)).toEqual([]);
  });

  it("says a price is wrong rather than missing — the office can see it is not empty", () => {
    const f = { ...emptyBooking, enabled: true, nightly_rate: "غالي", tourism_license_no: "TL-9" };
    expect(bookingBlockers(f).join(" ")).toContain("ليس رقمًا موجبًا");
    expect(bookingBlockers(f).join(" ")).not.toContain("أضف سعر الليلة");
  });

  it("catches a bad weekend rate and guest count, which the database would silently null", () => {
    const base = { ...emptyBooking, enabled: true, nightly_rate: "1500", tourism_license_no: "T" };
    expect(bookingBlockers({ ...base, weekend_rate: "مجانًا" }).join(" ")).toContain(
      "نهاية الأسبوع",
    );
    expect(bookingBlockers({ ...base, max_guests: "كثير" }).join(" ")).toContain("أقصى عدد ضيوف");
    // الفارغ ليس خطأً: سعر نهاية الأسبوع يساوي سعر الأسبوع، وعدد الضيوف غير محدَّد.
    expect(bookingBlockers({ ...base, weekend_rate: "", max_guests: "" })).toEqual([]);
  });

  it("catches identical check-in and check-out times", () => {
    const f = bookingFromRow(row({ checkin_time: "16:00:00", checkout_time: "16:00:00" }));
    expect(bookingBlockers(f).join(" ")).toContain("متطابقان");
  });
});
