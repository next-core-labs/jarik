import { describe, expect, it } from "vitest";

import { isValidChannelToken, safeEqual } from "./webhook-auth.server";

describe("safeEqual", () => {
  it("matches equal strings and rejects different ones, including different lengths", () => {
    expect(safeEqual("abc12345", "abc12345")).toBe(true);
    expect(safeEqual("abc12345", "abc12346")).toBe(false);
    expect(safeEqual("abc12345", "abc1234")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("isValidChannelToken", () => {
  const token = "a1b2c3d4e5f6a1b2c3d4e5f6";

  it("accepts the exact token", () => {
    expect(isValidChannelToken(token, token)).toBe(true);
  });

  it("rejects a wrong, empty or missing presented token", () => {
    expect(isValidChannelToken(token, "nope")).toBe(false);
    expect(isValidChannelToken(token, "")).toBe(false);
    expect(isValidChannelToken(token, null)).toBe(false);
    expect(isValidChannelToken(token, undefined)).toBe(false);
  });

  it("rejects channels that have no usable token, even if the caller sends nothing", () => {
    expect(isValidChannelToken(null, "")).toBe(false);
    expect(isValidChannelToken(undefined, undefined)).toBe(false);
    expect(isValidChannelToken("", "")).toBe(false);
    expect(isValidChannelToken("short", "short")).toBe(false);
  });
});
