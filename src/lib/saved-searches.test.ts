import { describe, expect, it } from "vitest";

import { savedSearchLabel, type SavedSearch } from "./saved-searches";

const search = (over: Partial<SavedSearch> = {}): SavedSearch => ({
  id: "s1",
  user_id: "u1",
  text_query: "",
  purpose: "all",
  unit_type: "",
  min_rooms: 0,
  furnished: "all",
  max_price: null,
  created_at: "2026-11-18T00:00:00Z",
  last_notified_at: "2026-11-18T00:00:00Z",
  ...over,
});

describe("savedSearchLabel", () => {
  it("spells out every set filter and skips the unset ones", () => {
    const label = savedSearchLabel(
      search({
        purpose: "rent",
        unit_type: "شقة",
        min_rooms: 3,
        furnished: "yes",
        max_price: 50000,
        text_query: "الملقا",
      }),
      "ar",
    );
    expect(label).toContain("للإيجار");
    expect(label).toContain("شقة");
    expect(label).toContain("3+ غرف");
    expect(label).toContain("«الملقا»");
    expect(label).not.toContain("null");
  });

  it("falls back to «الكل» when nothing is filtered", () => {
    expect(savedSearchLabel(search(), "ar")).toBe("الكل");
  });
});
