import { describe, expect, it } from "vitest";
import { arCount, arPct, daysLabel } from "@/lib/format";

describe("daysLabel", () => {
  it("uses the singular and dual forms for one and two", () => {
    expect(daysLabel(1)).toBe("يوم واحد");
    expect(daysLabel(2)).toBe("يومان");
  });

  it("uses أيام for 3 to 10 and يومًا from 11 up", () => {
    expect(daysLabel(3)).toBe(`${(3).toLocaleString("ar-SA")} أيام`);
    expect(daysLabel(10)).toBe(`${(10).toLocaleString("ar-SA")} أيام`);
    expect(daysLabel(11)).toBe(`${(11).toLocaleString("ar-SA")} يومًا`);
    expect(daysLabel(60)).toBe(`${(60).toLocaleString("ar-SA")} يومًا`);
  });

  it("labels the magnitude of a negative count (days already passed)", () => {
    expect(daysLabel(-5)).toBe(daysLabel(5));
  });
});

describe("arCount", () => {
  const units = {
    one: "وحدة شاغرة",
    two: "وحدتان شاغرتان",
    few: "وحدات شاغرة",
    many: "وحدة شاغرة",
  };
  it("agrees in number", () => {
    expect(arCount(1, units)).toBe("وحدة شاغرة");
    expect(arCount(2, units)).toBe("وحدتان شاغرتان");
    expect(arCount(7, units)).toBe(`${(7).toLocaleString("ar-SA")} وحدات شاغرة`);
    expect(arCount(15, units)).toBe(`${(15).toLocaleString("ar-SA")} وحدة شاغرة`);
  });
});

describe("arPct", () => {
  it("uses Arabic-Indic digits and the Arabic percent sign", () => {
    expect(arPct(71)).toBe(new Intl.NumberFormat("ar-SA", { style: "percent" }).format(0.71));
    expect(arPct(71)).not.toMatch(/[0-9]/);
  });
});
