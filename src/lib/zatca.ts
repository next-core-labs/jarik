// بناء حمولة رمز QR وفق متطلبات هيئة الزكاة والضريبة والجمارك (TLV مُشفّر Base64)

function tlv(tag: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  // The length field is a single byte; beyond 255 it wraps and silently corrupts the whole QR.
  if (bytes.length > 255) {
    throw new Error("قيمة طويلة جدًا لرمز QR (الحد 255 بايت) — اختصر اسم المنشأة");
  }
  const out = new Uint8Array(bytes.length + 2);
  out[0] = tag;
  out[1] = bytes.length;
  out.set(bytes, 2);
  return out;
}

function toBase64(chunks: Uint8Array[]) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  let binary = "";
  for (const byte of merged) binary += String.fromCharCode(byte);
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(merged).toString("base64");
}

export function buildZatcaQrPayload(input: {
  sellerName: string;
  sellerVatNumber: string;
  issueDate: string;
  total: number;
  vatAmount: number;
}) {
  return toBase64([
    tlv(1, input.sellerName),
    tlv(2, input.sellerVatNumber),
    tlv(3, new Date(input.issueDate).toISOString()),
    tlv(4, input.total.toFixed(2)),
    tlv(5, input.vatAmount.toFixed(2)),
  ]);
}

/**
 * Amount ENTERED INCLUDES VAT: back out the subtotal. Works in whole halalas and derives VAT as
 * total - subtotal, so subtotal + VAT always equals the total exactly (the printed lines, the
 * stored row and the QR can never disagree by a halala).
 */
export function splitVat(totalWithVat: number, vatRate: number) {
  const totalHalalas = Math.round(totalWithVat * 100);
  const subtotalHalalas = Math.round(totalHalalas / (1 + vatRate / 100));
  return {
    subtotal: subtotalHalalas / 100,
    vatAmount: (totalHalalas - subtotalHalalas) / 100,
    total: totalHalalas / 100,
  };
}

/**
 * Amount ENTERED IS BEFORE VAT: add VAT on top. The total is subtotal + VAT (both already rounded
 * to halalas). Rounding the total independently, as the invoice screen used to, disagreed with
 * subtotal + VAT by a halala for some amounts (1.50 -> 1.50 + 0.22 but total 1.73).
 */
export function addVat(subtotalExVat: number, vatRate: number) {
  const subtotalHalalas = Math.round(subtotalExVat * 100);
  const vatHalalas = Math.round((subtotalHalalas * vatRate) / 100);
  return {
    subtotal: subtotalHalalas / 100,
    vatAmount: vatHalalas / 100,
    total: (subtotalHalalas + vatHalalas) / 100,
  };
}

// فحص مطابقة الفاتورة لمتطلبات هيئة الزكاة والضريبة قبل التنزيل
export function validateZatcaInvoice(input: {
  sellerName: string;
  sellerVatNumber: string;
  crNumber?: string | null;
  customerName: string;
  customerVatNumber?: string | null;
  invoiceNumber: string;
  issueDate: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  vatRate: number;
  qrPayload: string;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const vatRegex = /^3\d{13}3$/;

  if (!input.sellerName.trim()) errors.push("اسم المنشأة البائعة مطلوب على الفاتورة.");
  if (!input.sellerVatNumber.trim()) {
    errors.push("الرقم الضريبي للمنشأة مطلوب.");
  } else if (!vatRegex.test(input.sellerVatNumber.trim())) {
    errors.push("الرقم الضريبي للمنشأة يجب أن يكون ١٥ رقمًا يبدأ وينتهي بالرقم ٣.");
  }
  if (!input.customerName.trim()) errors.push("اسم العميل مطلوب.");
  if (input.customerVatNumber && !vatRegex.test(input.customerVatNumber.trim())) {
    errors.push("الرقم الضريبي للعميل غير صحيح (١٥ رقمًا يبدأ وينتهي بـ ٣).");
  }
  if (!input.invoiceNumber.trim()) errors.push("رقم الفاتورة مطلوب.");
  if (Number.isNaN(new Date(input.issueDate).getTime())) errors.push("تاريخ الإصدار غير صحيح.");
  if (!(input.total > 0)) errors.push("إجمالي الفاتورة يجب أن يكون أكبر من صفر.");

  const expectedVat = Math.round(input.subtotal * (input.vatRate / 100) * 100) / 100;
  if (Math.abs(expectedVat - input.vatAmount) > 0.02) {
    errors.push("مبلغ الضريبة لا يطابق نسبة الضريبة على المبلغ قبل الضريبة.");
  }
  if (Math.abs(input.subtotal + input.vatAmount - input.total) > 0.02) {
    errors.push("الإجمالي لا يساوي المبلغ قبل الضريبة مضافًا إليه الضريبة.");
  }
  if (!input.qrPayload) errors.push("رمز QR لم يُولَّد.");

  if (!input.crNumber?.trim())
    warnings.push("السجل التجاري غير مسجّل — يُفضّل إظهاره على الفاتورة.");

  return { ok: errors.length === 0, errors, warnings };
}
