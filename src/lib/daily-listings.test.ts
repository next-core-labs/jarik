import { describe, expect, it } from "vitest";

import {
  bookingStats,
  dailyListingStatus,
  guestKey,
  hasEmbeddedRow,
  isDailyOnly,
  summarizeGuests,
  type GuestBooking,
} from "./daily-listings";

const booking = (over: Partial<GuestBooking>): GuestBooking => ({
  guest_name: "سالم",
  guest_phone: "0501234567",
  status: "confirmed",
  nights: 2,
  total_amount: 3000,
  from_date: "2026-12-01",
  to_date: "2026-12-03",
  created_at: "2026-11-20T10:00:00Z",
  unit_label: "شاليه النخيل",
  ...over,
});

describe("isDailyOnly", () => {
  it("is a unit with booking settings and no annual rent or sale price", () => {
    expect(isDailyOnly({ annual_rent: 0, sale_price: 0, hasBookingSettings: true })).toBe(true);
    expect(isDailyOnly({ annual_rent: null, sale_price: null, hasBookingSettings: true })).toBe(
      true,
    );
  });

  it("keeps a unit that is also rented yearly or sold in the rental screens", () => {
    expect(isDailyOnly({ annual_rent: 40000, sale_price: 0, hasBookingSettings: true })).toBe(
      false,
    );
    expect(isDailyOnly({ annual_rent: 0, sale_price: 900000, hasBookingSettings: true })).toBe(
      false,
    );
  });

  it("never hides an ordinary unit that simply has no price yet", () => {
    expect(isDailyOnly({ annual_rent: 0, sale_price: 0, hasBookingSettings: false })).toBe(false);
  });
});

describe("hasEmbeddedRow", () => {
  it("reads a one-to-one embed as an object or as an array", () => {
    expect(hasEmbeddedRow({ unit_id: "u" })).toBe(true);
    expect(hasEmbeddedRow([{ unit_id: "u" }])).toBe(true);
    expect(hasEmbeddedRow(null)).toBe(false);
    expect(hasEmbeddedRow(undefined)).toBe(false);
    expect(hasEmbeddedRow([])).toBe(false);
  });
});

describe("dailyListingStatus", () => {
  const ready = {
    live: false,
    enabled: true,
    nightly_rate: 1500,
    tourism_license_no: "TL-1",
    market_listed: true,
    unit_status: "vacant",
  };

  it("trusts the public view when it shows the listing", () => {
    expect(dailyListingStatus({ ...ready, live: true }).state).toBe("live");
  });

  it("names what the office can fix, in the order it can fix it", () => {
    expect(dailyListingStatus({ ...ready, enabled: false }).state).toBe("paused");
    expect(dailyListingStatus({ ...ready, nightly_rate: null }).state).toBe("incomplete");
    const noLicense = dailyListingStatus({ ...ready, tourism_license_no: "  " });
    expect(noLicense.state).toBe("incomplete");
    expect(noLicense.hint).toContain("رخصة الإيواء");
    expect(dailyListingStatus({ ...ready, unit_status: "occupied" }).state).toBe("occupied");
    expect(dailyListingStatus({ ...ready, market_listed: false }).state).toBe("unpublished");
  });

  it("blames office verification only when the listing itself is complete", () => {
    expect(dailyListingStatus(ready).state).toBe("office_pending");
  });
});

describe("guestKey", () => {
  it("is the same for every way one mobile number is written", () => {
    expect(guestKey("0501234567")).toBe("501234567");
    expect(guestKey("+966 50 123 4567")).toBe("501234567");
    expect(guestKey("٠٥٠١٢٣٤٥٦٧")).toBe("501234567");
  });

  it("refuses what is not a phone number", () => {
    expect(guestKey("123")).toBeNull();
    expect(guestKey(null)).toBeNull();
  });
});

describe("summarizeGuests", () => {
  const today = "2026-11-21";

  it("counts one guest once across differently written numbers, with the latest name", () => {
    const guests = summarizeGuests(
      [
        booking({
          created_at: "2026-10-01T00:00:00Z",
          from_date: "2026-10-05",
          to_date: "2026-10-07",
        }),
        booking({
          guest_name: "سالم العتيبي",
          guest_phone: "+966501234567",
          created_at: "2026-11-10T00:00:00Z",
        }),
      ],
      today,
    );
    expect(guests).toHaveLength(1);
    expect(guests[0]).toMatchObject({
      name: "سالم العتيبي",
      requests: 2,
      stays: 2,
      nights: 4,
      spent: 6000,
    });
  });

  it("does not count money or nights for pending, rejected or cancelled requests", () => {
    const [g] = summarizeGuests(
      [
        booking({ status: "pending" }),
        booking({ status: "rejected", created_at: "2026-11-19T00:00:00Z" }),
        booking({ status: "cancelled", created_at: "2026-11-18T00:00:00Z" }),
      ],
      today,
    );
    expect(g).toMatchObject({
      requests: 3,
      stays: 0,
      nights: 0,
      spent: 0,
      pending: 1,
      cancelled: 2,
    });
  });

  it("ignores blocked dates — a block is not a guest", () => {
    expect(
      summarizeGuests([booking({ status: "blocked", guest_name: null, guest_phone: null })], today),
    ).toEqual([]);
  });

  it("finds the next and the last stay around today", () => {
    const [g] = summarizeGuests(
      [
        booking({ status: "completed", from_date: "2026-09-01", to_date: "2026-09-03" }),
        booking({ status: "completed", from_date: "2026-10-10", to_date: "2026-10-12" }),
        booking({ from_date: "2026-12-20", to_date: "2026-12-22" }),
        booking({ from_date: "2026-12-01", to_date: "2026-12-03" }),
      ],
      today,
    );
    expect(g?.lastStay?.from).toBe("2026-10-10");
    expect(g?.nextStay?.from).toBe("2026-12-01");
  });

  it("puts guests who are about to arrive first, then the most recent", () => {
    const guests = summarizeGuests(
      [
        booking({
          guest_phone: "0500000001",
          status: "completed",
          from_date: "2026-11-01",
          to_date: "2026-11-02",
          created_at: "2026-11-20T00:00:00Z",
        }),
        booking({ guest_phone: "0500000002", from_date: "2026-12-10", to_date: "2026-12-12" }),
        booking({ guest_phone: "0500000003", from_date: "2026-11-25", to_date: "2026-11-27" }),
      ],
      today,
    );
    expect(guests.map((g) => g.key)).toEqual(["500000003", "500000002", "500000001"]);
  });
});

describe("bookingStats", () => {
  it("counts pending, upcoming, today's arrivals and this month's revenue", () => {
    const stats = bookingStats(
      [
        booking({ status: "pending" }),
        booking({ from_date: "2026-11-21", to_date: "2026-11-23", total_amount: 2000 }),
        booking({ status: "completed", from_date: "2026-11-02", to_date: "2026-11-04" }),
        booking({ status: "cancelled", from_date: "2026-11-05", to_date: "2026-11-06" }),
        booking({ from_date: "2026-12-01", to_date: "2026-12-03" }),
      ],
      "2026-11-21",
    );
    expect(stats).toEqual({ pending: 1, upcoming: 2, arrivingToday: 1, monthRevenue: 5000 });
  });
});
