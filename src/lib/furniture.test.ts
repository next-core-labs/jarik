import { describe, expect, it } from "vitest";

import { furnitureSummary, isFurnishing, parseFurniture } from "./furniture";

describe("parseFurniture", () => {
  it("keeps valid items and clamps quantities to 1–99", () => {
    expect(
      parseFurniture([
        { name: " مكيف سبليت ", qty: 3 },
        { name: "ثلاجة" },
        { name: "كنب", qty: 0 },
        { name: "سرير", qty: 500 },
      ]),
    ).toEqual([
      { name: "مكيف سبليت", qty: 3 },
      { name: "ثلاجة", qty: 1 },
      { name: "كنب", qty: 1 },
      { name: "سرير", qty: 99 },
    ]);
  });

  it("drops anything that is not a named item", () => {
    expect(parseFurniture([null, "x", { qty: 2 }, { name: "  " }])).toEqual([]);
    expect(parseFurniture({ name: "x" })).toEqual([]);
    expect(parseFurniture(null)).toEqual([]);
  });
});

describe("furnitureSummary", () => {
  it("shows quantities above one and counts what does not fit", () => {
    const items = [
      { name: "مكيف سبليت", qty: 3 },
      { name: "ثلاجة", qty: 1 },
      { name: "فرن", qty: 1 },
    ];
    expect(furnitureSummary(items)).toBe("مكيف سبليت ×3، ثلاجة، فرن");
    expect(furnitureSummary(items, 2)).toBe("مكيف سبليت ×3، ثلاجة و1 أخرى");
  });
});

describe("isFurnishing", () => {
  it("accepts only the three stored levels", () => {
    expect(["none", "partial", "full"].every(isFurnishing)).toBe(true);
    expect(isFurnishing("yes")).toBe(false);
    expect(isFurnishing(null)).toBe(false);
  });
});
