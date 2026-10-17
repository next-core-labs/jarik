import { describe, expect, it } from "vitest";

import { planUnitNumbers } from "./unit-numbering";

describe("planUnitNumbers", () => {
  it("numbers by floor with a two-digit index, the ground floor as G", () => {
    const plan = planUnitNumbers({
      fromFloor: 0,
      toFloor: 2,
      perFloor: 2,
      numbering: "floor",
      start: 1,
    });
    expect(plan.map((p) => p.unit_number)).toEqual(["G01", "G02", "101", "102", "201", "202"]);
    expect(plan.map((p) => p.floor)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("numbers sequentially from the start across floors", () => {
    const plan = planUnitNumbers({
      fromFloor: 1,
      toFloor: 3,
      perFloor: 2,
      numbering: "sequential",
      start: 5,
    });
    expect(plan.map((p) => p.unit_number)).toEqual(["5", "6", "7", "8", "9", "10"]);
  });

  it("goes past 99 on a floor without colliding with the next floor's prefix", () => {
    const plan = planUnitNumbers({
      fromFloor: 1,
      toFloor: 1,
      perFloor: 10,
      numbering: "floor",
      start: 1,
    });
    expect(plan.at(-1)?.unit_number).toBe("110");
    expect(new Set(plan.map((p) => p.unit_number)).size).toBe(10);
  });

  it("plans nothing when the floors are reversed", () => {
    expect(
      planUnitNumbers({ fromFloor: 3, toFloor: 1, perFloor: 2, numbering: "floor", start: 1 }),
    ).toEqual([]);
  });
});
