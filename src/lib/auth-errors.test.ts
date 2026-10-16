import { describe, expect, it } from "vitest";

import { emailProblem, NETWORK_ERROR_AR, userErrorMessage } from "./auth-errors";

describe("userErrorMessage", () => {
  it("passes our own Arabic messages through", () => {
    expect(userErrorMessage(new Error("الحساب مقفل مؤقتًا"), "x")).toBe("الحساب مقفل مؤقتًا");
  });

  it("names a dropped connection in every browser's wording", () => {
    for (const m of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
    ]) {
      expect(userErrorMessage(new TypeError(m), "x")).toBe(NETWORK_ERROR_AR);
    }
    expect(userErrorMessage({ name: "AuthRetryableFetchError", message: "{}" }, "x")).toBe(
      NETWORK_ERROR_AR,
    );
    // PostgREST returns the fetch failure as a plain object, not an Error.
    expect(userErrorMessage({ message: "TypeError: Failed to fetch" }, "x")).toBe(NETWORK_ERROR_AR);
  });

  it("replaces any other English library message with the screen's fallback", () => {
    expect(
      userErrorMessage(new Error("new row violates row-level security policy"), "تعذّر الحفظ"),
    ).toBe("تعذّر الحفظ");
    expect(userErrorMessage(null, "تعذّر الحفظ")).toBe("تعذّر الحفظ");
    expect(userErrorMessage("boom", "تعذّر الحفظ")).toBe("تعذّر الحفظ");
  });
});

describe("emailProblem", () => {
  it("asks for an email, then for a valid one", () => {
    expect(emailProblem(" ")).toBe("أدخل بريدك الإلكتروني");
    expect(emailProblem("not-an-email")).toBe("البريد الإلكتروني غير صحيح");
    expect(emailProblem("a@b.co")).toBeNull();
  });
});
