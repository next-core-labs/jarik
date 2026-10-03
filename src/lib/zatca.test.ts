import { describe, expect, it } from "vitest";

import { addVat, buildZatcaQrPayload, splitVat, validateZatcaInvoice } from "./zatca";

const halalas = (n: number) => Math.round(n * 100);

/** Decode the Base64 TLV payload back into { tag: value }. */
function decodeTlv(base64: string): Record<number, string> {
  const bytes = Buffer.from(base64, "base64");
  const out: Record<number, string> = {};
  for (let i = 0; i < bytes.length;) {
    const tag = bytes[i]!;
    const len = bytes[i + 1]!;
    out[tag] = new TextDecoder().decode(bytes.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return out;
}

describe("splitVat (amount includes VAT)", () => {
  it("backs out 15% VAT from a round total", () => {
    expect(splitVat(115, 15)).toEqual({ subtotal: 100, vatAmount: 15, total: 115 });
  });

  it("keeps subtotal + VAT equal to the total to the halala, for every amount", () => {
    for (let h = 1; h <= 200_000; h += 7) {
      const total = h / 100;
      const r = splitVat(total, 15);
      expect(halalas(r.subtotal) + halalas(r.vatAmount)).toBe(halalas(r.total));
      expect(halalas(r.total)).toBe(h);
    }
  });

  it("keeps the VAT within one halala of the exact rate", () => {
    for (let h = 100; h <= 200_000; h += 13) {
      const r = splitVat(h / 100, 15);
      expect(Math.abs(r.vatAmount - r.subtotal * 0.15)).toBeLessThan(0.0101);
    }
  });
});

describe("addVat (amount is before VAT)", () => {
  it("adds 15% on top of a round subtotal", () => {
    expect(addVat(100, 15)).toEqual({ subtotal: 100, vatAmount: 15, total: 115 });
  });

  it("makes total equal subtotal + VAT for every amount (the old code failed ~1.7% of them)", () => {
    for (let h = 1; h <= 200_000; h++) {
      const r = addVat(h / 100, 15);
      expect(halalas(r.subtotal) + halalas(r.vatAmount)).toBe(halalas(r.total));
    }
  });

  it("gives the values shown on the invoice for the case that used to disagree", () => {
    // Before: total was rounded separately (1.73) while lines showed 1.50 + 0.22.
    expect(addVat(1.5, 15)).toEqual({ subtotal: 1.5, vatAmount: 0.23, total: 1.73 });
  });
});

describe("buildZatcaQrPayload", () => {
  it("encodes the five mandatory fields", () => {
    const qr = buildZatcaQrPayload({
      sellerName: "مؤسسة جارك",
      sellerVatNumber: "300000000000003",
      issueDate: "2026-09-20T10:00:00Z",
      total: 115.5,
      vatAmount: 15.07,
    });
    expect(decodeTlv(qr)).toEqual({
      1: "مؤسسة جارك",
      2: "300000000000003",
      3: "2026-09-20T10:00:00.000Z",
      4: "115.50",
      5: "15.07",
    });
  });

  it("refuses a value longer than the single length byte can express", () => {
    expect(() =>
      buildZatcaQrPayload({
        sellerName: "ش".repeat(200), // 400 bytes in UTF-8
        sellerVatNumber: "300000000000003",
        issueDate: "2026-09-20T10:00:00Z",
        total: 1,
        vatAmount: 0.13,
      }),
    ).toThrow();
  });
});

describe("validateZatcaInvoice", () => {
  const base = {
    sellerName: "مؤسسة جارك",
    sellerVatNumber: "300000000000003",
    crNumber: "1010000000",
    customerName: "عميل",
    customerVatNumber: null,
    invoiceNumber: "INV-2026-0001",
    issueDate: "2026-09-20T10:00:00Z",
    subtotal: 100,
    vatAmount: 15,
    total: 115,
    vatRate: 15,
    qrPayload: "abc",
  };

  it("accepts a consistent invoice", () => {
    expect(validateZatcaInvoice(base).ok).toBe(true);
  });

  it("flags a bad VAT number and an inconsistent total", () => {
    expect(validateZatcaInvoice({ ...base, sellerVatNumber: "123" }).ok).toBe(false);
    expect(validateZatcaInvoice({ ...base, total: 130 }).ok).toBe(false);
  });
});
