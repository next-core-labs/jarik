import { describe, expect, it } from "vitest";

import { appPath } from "./app-path";

describe("appPath", () => {
  it("ignores case and trailing slashes, like the router's matching", () => {
    expect(appPath("/hq")).toBe("/hq");
    expect(appPath("/HQ")).toBe("/hq");
    expect(appPath("/hQ/")).toBe("/hq");
    expect(appPath("/hq//")).toBe("/hq");
    expect(appPath("/Owner/Settings/")).toBe("/owner/settings");
  });

  it("keeps the root path", () => {
    expect(appPath("/")).toBe("/");
    expect(appPath("")).toBe("/");
  });
});
