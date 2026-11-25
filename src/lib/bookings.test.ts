import { describe, expect, it } from "vitest";

import {
  addDays,
  bookedNights,
  bookingStatusLabel,
  firstFreeCheckin,
  isBookingStatus,
  nightsBetween,
  occupiesDates,
  OCCUPYING_STATUSES,
  overlapsBooked,
  splitMyBookings,
  toDateInput,
} from "./bookings";

describe("nightsBetween", () => {
  it("counts nights, not days — the checkout day is not a night", () => {
    expect(nightsBetween("2026-12-01", "2026-12-04")).toBe(3);
    expect(nightsBetween("2026-12-01", "2026-12-02")).toBe(1);
  });

  it("is zero or negative for an invalid range, never NaN", () => {
    expect(nightsBetween("2026-12-04", "2026-12-01")).toBe(-3);
    expect(nightsBetween("2026-12-01", "2026-12-01")).toBe(0);
    expect(nightsBetween("", "2026-12-01")).toBe(0);
    expect(nightsBetween("not-a-date", "2026-12-01")).toBe(0);
  });

  it("counts correctly across a month boundary and a DST-free leap day", () => {
    expect(nightsBetween("2026-11-28", "2026-12-02")).toBe(4);
    expect(nightsBetween("2028-02-28", "2028-03-01")).toBe(2); // 2028 كبيسة
  });
});

describe("overlapsBooked", () => {
  // ★ دلالة `[دخول، خروج)` هي عين ما يحرسه قيد EXCLUDE في القاعدة: يوم الخروج حرّ للضيف التالي.
  const booked = [{ from_date: "2026-12-10", to_date: "2026-12-15" }];

  it("lets a new stay start on the day the previous one ends", () => {
    expect(overlapsBooked("2026-12-15", "2026-12-18", booked)).toBe(false);
  });

  it("lets a new stay end on the day the next one starts", () => {
    expect(overlapsBooked("2026-12-07", "2026-12-10", booked)).toBe(false);
  });

  it("catches every real overlap", () => {
    expect(overlapsBooked("2026-12-11", "2026-12-13", booked)).toBe(true); // داخله
    expect(overlapsBooked("2026-12-08", "2026-12-12", booked)).toBe(true); // يتقدّمه
    expect(overlapsBooked("2026-12-13", "2026-12-17", booked)).toBe(true); // يتأخّره
    expect(overlapsBooked("2026-12-01", "2026-12-31", booked)).toBe(true); // يحيطه
    expect(overlapsBooked("2026-12-10", "2026-12-15", booked)).toBe(true); // مطابق
  });

  it("ignores an invalid range instead of claiming an overlap", () => {
    expect(overlapsBooked("2026-12-15", "2026-12-10", booked)).toBe(false);
    expect(overlapsBooked("2026-12-12", "2026-12-12", booked)).toBe(false);
  });

  it("checks against every booked range, not just the first", () => {
    const many = [
      { from_date: "2026-12-01", to_date: "2026-12-03" },
      { from_date: "2026-12-20", to_date: "2026-12-25" },
    ];
    expect(overlapsBooked("2026-12-21", "2026-12-22", many)).toBe(true);
    expect(overlapsBooked("2026-12-10", "2026-12-12", many)).toBe(false);
  });
});

describe("bookedNights", () => {
  it("marks the nights slept, leaving the checkout day free", () => {
    const nights = bookedNights([{ from_date: "2026-12-10", to_date: "2026-12-13" }]);
    expect([...nights].sort()).toEqual(["2026-12-10", "2026-12-11", "2026-12-12"]);
    expect(nights.has("2026-12-13")).toBe(false);
  });

  it("merges overlapping and adjacent ranges into one set", () => {
    const nights = bookedNights([
      { from_date: "2026-12-10", to_date: "2026-12-12" },
      { from_date: "2026-12-12", to_date: "2026-12-14" },
    ]);
    expect(nights.size).toBe(4);
  });
});

describe("addDays / toDateInput", () => {
  it("moves by whole days and crosses months", () => {
    expect(addDays("2026-11-28", 4)).toBe("2026-12-02");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("formats in local time, so «today» is the guest's today not UTC's", () => {
    const d = new Date(2026, 11, 31, 23, 30); // 31 ديسمبر محليًا، وقد يكون 1 يناير بـUTC
    expect(toDateInput(d)).toBe("2026-12-31");
  });
});

describe("booking statuses", () => {
  it("occupies dates for exactly the statuses the EXCLUDE constraint lists", () => {
    expect([...OCCUPYING_STATUSES].sort()).toEqual(["blocked", "confirmed", "pending"]);
    expect(occupiesDates("pending")).toBe(true);
    expect(occupiesDates("confirmed")).toBe(true);
    expect(occupiesDates("blocked")).toBe(true);
    // الرفض والإلغاء يحرّران الليالي لغير الضيف — وإلا بقيت وحدة معطّلة بطلب مرفوض.
    expect(occupiesDates("rejected")).toBe(false);
    expect(occupiesDates("cancelled")).toBe(false);
    expect(occupiesDates("completed")).toBe(false);
  });

  it("labels every status in both languages", () => {
    expect(bookingStatusLabel("pending")).toBe("بانتظار التأكيد");
    expect(bookingStatusLabel("confirmed", "en")).toBe("Confirmed");
  });

  it("guards against a status this build does not know", () => {
    expect(isBookingStatus("pending")).toBe(true);
    expect(isBookingStatus("some_new_status")).toBe(false);
    expect(isBookingStatus(null)).toBe(false);
  });
});

describe("splitMyBookings", () => {
  const row = (status: string, my_rating: number | null = null) => ({ status, my_rating });

  it("puts a finished stay with no review first, and only until it is rated", () => {
    const { toRate, past } = splitMyBookings([row("completed"), row("completed", 4)]);
    expect(toRate).toEqual([row("completed")]);
    expect(past).toEqual([row("completed", 4)]);
  });

  it("keeps pending and confirmed together as upcoming", () => {
    const { upcoming } = splitMyBookings([row("pending"), row("confirmed"), row("rejected")]);
    expect(upcoming.map((b) => b.status)).toEqual(["pending", "confirmed"]);
  });

  it("places every booking in exactly one section", () => {
    const rows = ["pending", "confirmed", "rejected", "cancelled", "completed"].map((s) => row(s));
    const { toRate, upcoming, past } = splitMyBookings(rows);
    expect(toRate.length + upcoming.length + past.length).toBe(rows.length);
    expect(past.map((b) => b.status)).toEqual(["rejected", "cancelled"]);
  });
});

describe("firstFreeCheckin", () => {
  // ★ حجب ثلاث ليالٍ يُزيح الضيف يومًا واحدًا، ولا يعني أن الوحدة لا تُحجز.
  it("lands on the checkout day of the block, which is itself free", () => {
    const booked = [{ from_date: "2026-12-10", to_date: "2026-12-13" }];
    expect(firstFreeCheckin("2026-12-10", 1, booked)).toBe("2026-12-13");
    expect(firstFreeCheckin("2026-12-11", 2, booked)).toBe("2026-12-13");
  });

  it("keeps the date the guest picked when nothing clashes", () => {
    const booked = [{ from_date: "2026-12-10", to_date: "2026-12-13" }];
    expect(firstFreeCheckin("2026-12-01", 3, booked)).toBe("2026-12-01");
    expect(firstFreeCheckin("2026-12-20", 5, booked)).toBe("2026-12-20");
  });

  it("skips a gap too short for the stay and jumps past the next block", () => {
    const booked = [
      { from_date: "2026-12-10", to_date: "2026-12-13" },
      { from_date: "2026-12-14", to_date: "2026-12-18" },
    ];
    // ليلة واحدة تسعها الفجوة 13→14؛ وثلاث ليالٍ لا، فتنتقل إلى ما بعد الحجب الثاني.
    expect(firstFreeCheckin("2026-12-10", 1, booked)).toBe("2026-12-13");
    expect(firstFreeCheckin("2026-12-10", 3, booked)).toBe("2026-12-18");
  });

  it("returns null only when the whole horizon is taken", () => {
    const booked = [{ from_date: "2026-12-10", to_date: "2027-12-20" }];
    expect(firstFreeCheckin("2026-12-10", 2, booked, 30)).toBeNull();
  });

  it("never suggests a date that overlaps, whatever the order of the ranges", () => {
    const booked = [
      { from_date: "2026-12-14", to_date: "2026-12-18" },
      { from_date: "2026-12-10", to_date: "2026-12-15" },
    ];
    const free = firstFreeCheckin("2026-12-09", 2, booked);
    expect(free).toBe("2026-12-18");
    expect(overlapsBooked(free!, addDays(free!, 2), booked)).toBe(false);
  });
});
