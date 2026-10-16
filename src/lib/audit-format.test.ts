import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/audit-format";
import {
  leaseStatusLabel,
  maintenanceStatusLabel,
  paymentStatusLabel,
  sar,
  shortDate,
  unitStatusLabel,
} from "@/lib/format";

describe("summarize", () => {
  it("shows statuses in Arabic using the table's own labels", () => {
    expect(summarize({ title: "تسريب", status: "in_progress" }, "maintenance_requests")).toBe(
      `تسريب · ${maintenanceStatusLabel["in_progress"]}`,
    );
    expect(summarize({ unit_number: "101", status: "occupied" }, "units")).toBe(
      `${unitStatusLabel["occupied"]} · 101`,
    );
    expect(summarize({ status: "active" }, "leases")).toBe(leaseStatusLabel["active"]);
  });

  it("falls back to a shared label when the table is unknown or not given", () => {
    expect(summarize({ status: "pending" })).toBe("قيد الانتظار");
    expect(summarize({ status: "paid" })).toBe(paymentStatusLabel["paid"]);
  });

  it("formats amounts in riyals and dates in Arabic", () => {
    expect(summarize({ amount: 9000, due_date: "2026-11-01" }, "payments")).toBe(
      `${sar(9000)} · ${shortDate("2026-11-01")}`,
    );
    expect(summarize({ annual_rent: "36000" }, "leases")).toBe(sar(36000));
  });

  it("keeps an unknown value as it is", () => {
    expect(summarize({ status: "something_new" }, "units")).toBe("something_new");
    expect(summarize(null)).toBe("");
  });
});
