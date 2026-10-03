import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-redirect";

describe("safeNext", () => {
  it("accepts same-origin relative paths, including query and hash", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/unit/123?tab=chat#top")).toBe("/unit/123?tab=chat#top");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/.lovable/oauth/consent?authorization_id=abc")).toBe(
      "/.lovable/oauth/consent?authorization_id=abc",
    );
  });

  it("rejects non-strings and paths that are not rooted", () => {
    for (const v of [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "dashboard",
      "https://evil.com",
      "javascript:alert(1)",
    ]) {
      expect(safeNext(v)).toBeNull();
    }
  });

  it("rejects protocol-relative and backslash open-redirect tricks", () => {
    expect(safeNext("//evil.com")).toBeNull();
    expect(safeNext("/\\evil.com")).toBeNull();
    expect(safeNext("/\\/evil.com")).toBeNull();
    expect(safeNext("/foo\\bar")).toBeNull();
  });

  it("rejects control characters browsers strip before parsing", () => {
    expect(safeNext("/\t/evil.com")).toBeNull();
    expect(safeNext("/\n/evil.com")).toBeNull();
    expect(safeNext("/\r/evil.com")).toBeNull();
    expect(safeNext("/a\u0000b")).toBeNull();
  });

  it("keeps percent-encoded look-alikes, which stay on the same origin", () => {
    expect(safeNext("/%5Cevil.com")).toBe("/%5Cevil.com");
    expect(safeNext("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });
});
