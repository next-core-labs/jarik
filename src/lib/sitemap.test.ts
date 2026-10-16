import { describe, expect, it } from "vitest";

import { sitemapRecordEntries, sitemapXML } from "./sitemap";

const UNIT_A = "e442a4ef-aee2-42f3-85fc-32ee335b7c35";
const UNIT_B = "d48b0eac-e2d8-4fa3-a531-a2f62bb6b08f";
const OFFICE = "de300000-0000-4000-8000-000000000001";

describe("sitemapRecordEntries", () => {
  it("lists office pages, then listings, each sorted and de-duplicated", () => {
    expect(sitemapRecordEntries([UNIT_A, UNIT_B, UNIT_A], [OFFICE])).toEqual([
      { path: `/office/${OFFICE}` },
      { path: `/unit/${UNIT_B}` },
      { path: `/unit/${UNIT_A}` },
    ]);
  });

  it("skips empty and malformed ids", () => {
    expect(sitemapRecordEntries([null, "", "../admin", "not-a-uuid"], [null, "x"])).toEqual([]);
  });

  it("renders into a valid sitemap next to the static pages", () => {
    const xml = sitemapXML("https://jarak-ksa.com", [
      { path: "/" },
      ...sitemapRecordEntries([UNIT_A], [OFFICE]),
    ]);
    expect(xml).toContain("<loc>https://jarak-ksa.com/</loc>");
    expect(xml).toContain(`<loc>https://jarak-ksa.com/office/${OFFICE}</loc>`);
    expect(xml).toContain(`<loc>https://jarak-ksa.com/unit/${UNIT_A}</loc>`);
  });
});
