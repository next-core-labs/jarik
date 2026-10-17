export type Numbering = "floor" | "sequential";

/**
 * The unit numbers a building's floors produce. "floor": the floor then a two-digit index (101, 102,
 * 201…; the ground floor is G01…). "sequential": one running number from `start`.
 */
export function planUnitNumbers(opts: {
  fromFloor: number;
  toFloor: number;
  perFloor: number;
  numbering: Numbering;
  start: number;
}): { unit_number: string; floor: number }[] {
  const out: { unit_number: string; floor: number }[] = [];
  let next = opts.start;
  for (let floor = opts.fromFloor; floor <= opts.toFloor; floor++) {
    for (let i = 1; i <= opts.perFloor; i++) {
      const idx = String(i).padStart(2, "0");
      out.push({
        unit_number:
          opts.numbering === "floor"
            ? floor === 0
              ? `G${idx}`
              : `${floor}${idx}`
            : String(next++),
        floor,
      });
    }
  }
  return out;
}
