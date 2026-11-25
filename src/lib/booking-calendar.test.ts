import { describe, expect, it } from "vitest";

import {
  bookingsInRange,
  monthGrid,
  monthOf,
  monthTotals,
  occupiesNight,
  rangeHasOccupied,
  rangeToStay,
  selectedRange,
  shiftMonth,
  type CalendarBooking,
} from "./booking-calendar";

const booking = (over: Partial<CalendarBooking> = {}): CalendarBooking => ({
  id: "b1",
  unit_id: "u1",
  from_date: "2026-12-10",
  to_date: "2026-12-13",
  status: "confirmed",
  guest_name: "ضيف",
  unit_label: "شالية النخيل",
  nights: 3,
  ...over,
});

describe("monthOf / shiftMonth", () => {
  it("moves across the year boundary in both directions", () => {
    expect(monthOf("2026-12-04")).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 13)).toBe("2028-01");
  });
});

describe("occupiesNight", () => {
  // ★ نفس دلالة `[دخول، خروج)` في القاعدة: يوم الخروج حرّ للضيف التالي.
  it("counts the check-in night and not the checkout day", () => {
    const b = booking();
    expect(occupiesNight(b, "2026-12-10")).toBe(true);
    expect(occupiesNight(b, "2026-12-12")).toBe(true);
    expect(occupiesNight(b, "2026-12-13")).toBe(false);
    expect(occupiesNight(b, "2026-12-09")).toBe(false);
  });
});

describe("monthGrid", () => {
  const grid = monthGrid("2026-12", [booking()], "2026-12-11");

  it("starts on a Sunday and ends on a Saturday, covering the whole month", () => {
    expect(grid.length % 7).toBe(0);
    expect(new Date(`${grid[0]!.date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(new Date(`${grid.at(-1)!.date}T00:00:00Z`).getUTCDay()).toBe(6);
    expect(grid.filter((d) => d.inMonth).length).toBe(31);
    expect(grid.find((d) => d.date === "2026-12-01")?.inMonth).toBe(true);
    expect(grid.find((d) => d.date === "2026-11-30")?.inMonth).toBe(false);
  });

  it("marks today and the past from the given day, not the machine clock", () => {
    expect(grid.find((d) => d.date === "2026-12-11")?.isToday).toBe(true);
    expect(grid.find((d) => d.date === "2026-12-10")?.isPast).toBe(true);
    expect(grid.find((d) => d.date === "2026-12-12")?.isPast).toBe(false);
  });

  it("puts the stay on its nights and the checkout on its own day", () => {
    expect(grid.find((d) => d.date === "2026-12-12")?.confirmed).toHaveLength(1);
    const checkoutDay = grid.find((d) => d.date === "2026-12-13");
    expect(checkoutDay?.confirmed).toHaveLength(0);
    expect(checkoutDay?.checkouts).toHaveLength(1);
  });

  it("ignores cancelled and rejected stays — they release the nights", () => {
    const released = monthGrid(
      "2026-12",
      [booking({ status: "cancelled" }), booking({ id: "b2", status: "rejected" })],
      "2026-12-01",
    );
    expect(released.find((d) => d.date === "2026-12-11")?.confirmed).toHaveLength(0);
    expect(released.find((d) => d.date === "2026-12-11")?.blocked).toHaveLength(0);
  });

  it("separates pending and blocked from confirmed on the same night", () => {
    const mixed = monthGrid(
      "2026-12",
      [
        booking(),
        booking({ id: "b2", status: "pending", from_date: "2026-12-20", to_date: "2026-12-22" }),
        booking({ id: "b3", status: "blocked", from_date: "2026-12-25", to_date: "2026-12-28" }),
      ],
      "2026-12-01",
    );
    expect(mixed.find((d) => d.date === "2026-12-21")?.pending).toHaveLength(1);
    expect(mixed.find((d) => d.date === "2026-12-26")?.blocked).toHaveLength(1);
    // الحجب ليس خروجًا يُنتظر فيه ضيف.
    expect(mixed.find((d) => d.date === "2026-12-28")?.checkouts).toHaveLength(0);
  });
});

describe("monthTotals", () => {
  it("counts each night once, by what occupies it, and never past the month", () => {
    const totals = monthTotals(
      monthGrid(
        "2026-12",
        [
          booking(), // 10، 11، 12 مؤكَّد
          booking({ id: "b2", status: "pending", from_date: "2026-12-20", to_date: "2026-12-22" }),
          booking({ id: "b3", status: "blocked", from_date: "2026-12-25", to_date: "2026-12-28" }),
        ],
        "2026-12-01",
      ),
    );
    expect(totals.confirmedNights).toBe(3);
    expect(totals.pendingNights).toBe(2);
    expect(totals.blockedNights).toBe(3);
    expect(
      totals.confirmedNights + totals.pendingNights + totals.blockedNights + totals.freeNights,
    ).toBe(31);
    expect(totals.occupancyPct).toBe(10);
  });

  it("does not count a neighbouring month's nights that only pad the grid", () => {
    const totals = monthTotals(
      monthGrid(
        "2026-12",
        [booking({ from_date: "2026-11-25", to_date: "2026-11-29" })],
        "2026-12-01",
      ),
    );
    expect(totals.confirmedNights).toBe(0);
    expect(totals.freeNights).toBe(31);
  });
});

describe("selectedRange / rangeToStay", () => {
  it("reads a backwards selection the same as a forwards one", () => {
    expect(selectedRange("2026-12-23", "2026-12-21")).toEqual({
      from: "2026-12-21",
      to: "2026-12-23",
    });
    expect(selectedRange("2026-12-21", null)).toEqual({ from: "2026-12-21", to: "2026-12-21" });
    expect(selectedRange(null, "2026-12-21")).toBeNull();
  });

  it("blocks the last picked day too — `[from, to+1)` as the office means it", () => {
    expect(rangeToStay({ from: "2026-12-21", to: "2026-12-23" })).toEqual({
      from: "2026-12-21",
      to: "2026-12-24",
    });
    // يوم واحد = ليلة واحدة.
    expect(rangeToStay({ from: "2026-12-21", to: "2026-12-21" })).toEqual({
      from: "2026-12-21",
      to: "2026-12-22",
    });
  });
});

describe("bookingsInRange / rangeHasOccupied", () => {
  const bookings = [
    booking(), // 10 → 13
    booking({ id: "b2", status: "cancelled", from_date: "2026-12-20", to_date: "2026-12-25" }),
  ];

  it("finds a stay that touches the selection, by nights not days", () => {
    expect(bookingsInRange(bookings, { from: "2026-12-12", to: "2026-12-12" })).toHaveLength(1);
    // يوم الخروج وحده: لا ليلة مشغولة فيه، فالحجب عليه مسموح.
    expect(bookingsInRange(bookings, { from: "2026-12-13", to: "2026-12-14" })).toHaveLength(0);
    expect(rangeHasOccupied(bookings, { from: "2026-12-09", to: "2026-12-10" })).toBe(true);
    expect(rangeHasOccupied(bookings, { from: "2026-12-13", to: "2026-12-19" })).toBe(false);
  });

  it("does not count a cancelled stay as occupying the dates", () => {
    expect(rangeHasOccupied(bookings, { from: "2026-12-21", to: "2026-12-22" })).toBe(false);
  });
});
