import { describe, expect, it } from "vitest";

import { escapeHtml } from "./escape-html";

describe("escapeHtml", () => {
  it("neutralises markup and attribute-breaking characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml(`a'b&c`)).toBe("a&#39;b&amp;c");
  });

  it("leaves Arabic text and plain strings untouched", () => {
    expect(escapeHtml("برج الياسمين — حي النرجس")).toBe("برج الياسمين — حي النرجس");
  });

  it("treats null and undefined as empty and stringifies numbers", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(12)).toBe("12");
  });
});
