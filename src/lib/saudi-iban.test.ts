import { describe, expect, it } from "vitest";

import { formatIban, normalizeIban, saudiIbanError } from "@/lib/saudi-iban";

// The specimen Saudi IBAN from the IBAN registry.
const VALID = "SA0380000000608010167519";

describe("saudi iban", () => {
  it("accepts a valid IBAN however it is typed", () => {
    expect(saudiIbanError(VALID)).toBeNull();
    expect(saudiIbanError("sa03 8000 0000 6080 1016 7519")).toBeNull();
    expect(saudiIbanError("SA٠٣٨٠٠٠٠٠٠٠٦٠٨٠١٠١٦٧٥١٩")).toBeNull();
  });

  it("rejects a wrong country, a wrong length and a mistyped digit", () => {
    expect(saudiIbanError("AE070331234567890123456")).toMatch(/SA/);
    expect(saudiIbanError("SA03800000006080101675")).toMatch(/24/);
    expect(saudiIbanError("SA0380000000608010167518")).toMatch(/غير صحيح/);
  });

  it("stores it compact and prints it in fours", () => {
    expect(normalizeIban(" sa03-8000 0000 6080 1016 7519 ")).toBe(VALID);
    expect(formatIban(VALID)).toBe("SA03 8000 0000 6080 1016 7519");
  });
});
