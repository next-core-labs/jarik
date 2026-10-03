import { describe, expect, it } from "vitest";

// Only the pure helpers are imported; the module also imports the Supabase client, which is a
// lazy proxy and is never touched here.
import { planPhotoSync, validateImageFile } from "./unit-photos";

const ex = (id: string, position: number) => ({ id, path: `u/${id}.jpg`, position });

describe("planPhotoSync", () => {
  it("does nothing when the editor matches the database", () => {
    const plan = planPhotoSync(
      [ex("a", 0), ex("b", 1)],
      [
        { key: "k1", id: "a" },
        { key: "k2", id: "b" },
      ],
    );
    expect(plan).toEqual({ toDelete: [], toInsert: [], toMove: [] });
  });

  it("inserts new files at the position they have in the editor", () => {
    const plan = planPhotoSync(
      [ex("a", 0)],
      [
        { key: "new1", id: null },
        { key: "k1", id: "a" },
        { key: "new2", id: null },
      ],
    );
    expect(plan.toInsert).toEqual([
      { key: "new1", position: 0 },
      { key: "new2", position: 2 },
    ]);
    // "a" was first, now second: it moves.
    expect(plan.toMove).toEqual([{ id: "a", position: 1 }]);
    expect(plan.toDelete).toEqual([]);
  });

  it("deletes photos that were removed and re-numbers the ones that stay", () => {
    const plan = planPhotoSync(
      [ex("a", 0), ex("b", 1), ex("c", 2)],
      [
        { key: "k1", id: "a" },
        { key: "k3", id: "c" },
      ],
    );
    expect(plan.toDelete.map((p) => p.id)).toEqual(["b"]);
    expect(plan.toMove).toEqual([{ id: "c", position: 1 }]);
    expect(plan.toInsert).toEqual([]);
  });

  it("making another photo the cover moves only what changed", () => {
    const plan = planPhotoSync(
      [ex("a", 0), ex("b", 1), ex("c", 2)],
      [
        { key: "k2", id: "b" },
        { key: "k1", id: "a" },
        { key: "k3", id: "c" },
      ],
    );
    expect(plan.toMove).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });

  it("removing everything deletes every saved photo", () => {
    const plan = planPhotoSync([ex("a", 0), ex("b", 1)], []);
    expect(plan.toDelete).toHaveLength(2);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toMove).toEqual([]);
  });
});

describe("validateImageFile", () => {
  it("accepts JPG, PNG and WebP of a sensible size", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateImageFile({ type, size: 3_000_000 })).toBeNull();
    }
  });

  it("rejects other types, empty files and huge files", () => {
    expect(validateImageFile({ type: "image/gif", size: 1000 })).toMatch(/غير مدعومة/);
    expect(validateImageFile({ type: "application/pdf", size: 1000 })).toMatch(/غير مدعومة/);
    expect(validateImageFile({ type: "image/jpeg", size: 0 })).toMatch(/فارغ/);
    expect(validateImageFile({ type: "image/jpeg", size: 30 * 1024 * 1024 })).toMatch(/كبيرة/);
  });
});
