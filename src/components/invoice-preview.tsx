import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { arPct, sar2, shortDate } from "@/lib/format";
import { downloadElementAsPdf } from "@/lib/pdf";
import { validateZatcaInvoice } from "@/lib/zatca";

/** One invoice as it prints: what was issued, plus the office details shown beside it. */
export type InvoiceView = {
  invoiceNumber: string;
  customerName: string;
  customerVat: string;
  description: string;
  issueDate: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  qrPayload: string;
  sellerName: string;
  sellerVat: string;
  crNumber: string | null;
  officeCode: string | null;
  address: string | null;
  vatRate: number;
};

/** The ZATCA QR as a crisp PNG data URL ("" while it renders). */
function useQrImage(payload: string) {
  const [image, setImage] = useState("");
  useEffect(() => {
    // A slower render for an earlier invoice must not land after a later one's.
    let current = true;
    setImage("");
    // Nothing issued yet (or an old invoice without a payload): no QR, and no "No input text" error.
    if (!payload) return;
    void (async () => {
      try {
        const QR = await import("qrcode");
        const dataUrl = await QR.toDataURL(payload, {
          margin: 2,
          width: 320,
          errorCorrectionLevel: "M",
        });
        if (current) setImage(dataUrl);
      } catch (e) {
        console.error("Invoice QR failed", e);
      }
    })();
    return () => {
      current = false;
    };
  }, [payload]);
  return image;
}

/**
 * The printable simplified tax invoice with its ZATCA check and a PDF download — used right after
 * issuing (/invoices/new) and when an invoice is opened from the list (/invoices/$invoiceId).
 */
export function InvoicePreviewCard({
  invoice,
  logoDataUrl,
}: {
  invoice: InvoiceView | null;
  logoDataUrl: string;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const qrImage = useQrImage(invoice?.qrPayload ?? "");

  const check = invoice
    ? validateZatcaInvoice({
        sellerName: invoice.sellerName,
        sellerVatNumber: invoice.sellerVat,
        crNumber: invoice.crNumber,
        customerName: invoice.customerName,
        customerVatNumber: invoice.customerVat || null,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: invoice.issueDate,
        subtotal: invoice.subtotal,
        vatAmount: invoice.vatAmount,
        total: invoice.total,
        vatRate: invoice.vatRate,
        qrPayload: invoice.qrPayload,
      })
    : null;

  async function downloadPdf() {
    if (!printRef.current || !invoice) return;
    if (check && !check.ok) {
      toast.error(`الفاتورة لم تمر فحص هيئة الزكاة والضريبة: ${check.errors[0]}`);
      return;
    }
    try {
      await downloadElementAsPdf(printRef.current, invoice.invoiceNumber);
    } catch (e) {
      console.error("Invoice PDF failed", e);
      toast.error("تعذّر إنشاء ملف PDF");
    }
  }

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">معاينة الفاتورة</CardTitle>
          {invoice ? (
            <Button variant="outline" size="sm" onClick={downloadPdf}>
              <Download className="size-4" />
              تنزيل PDF
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!invoice ? (
          <p className="text-sm text-muted-foreground">
            أصدر الفاتورة لتظهر المعاينة وزر تنزيل ملف PDF.
          </p>
        ) : (
          <div ref={printRef} dir="rtl" className="rounded-md bg-white p-6 text-[13px] text-black">
            <div className="flex items-start justify-between border-b border-black/20 pb-4">
              <div className="flex items-start gap-3">
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt="شعار المنشأة" className="h-14 w-auto" />
                ) : null}
                <div>
                  <p className="text-lg font-bold">{invoice.sellerName}</p>
                  <p>الرقم الضريبي: {invoice.sellerVat}</p>
                  {invoice.crNumber ? <p>السجل التجاري: {invoice.crNumber}</p> : null}
                  {invoice.officeCode ? <p>شفرة المكتب: {invoice.officeCode}</p> : null}
                  {invoice.address ? <p>{invoice.address}</p> : null}
                </div>
              </div>
              <div className="text-end">
                <p className="font-bold">فاتورة ضريبية مبسطة</p>
                <p>{invoice.invoiceNumber}</p>
                <p>{shortDate(invoice.issueDate)}</p>
              </div>
            </div>

            <div className="mt-4">
              <p className="font-bold">العميل</p>
              <p>{invoice.customerName}</p>
              {invoice.customerVat ? <p>الرقم الضريبي: {invoice.customerVat}</p> : null}
            </div>

            <table className="mt-4 w-full border-collapse text-start">
              <thead>
                <tr className="bg-black/5">
                  <th className="border border-black/20 p-2 text-start">البند</th>
                  <th className="border border-black/20 p-2 text-start">قبل الضريبة</th>
                  <th className="border border-black/20 p-2 text-start">
                    الضريبة {arPct(invoice.vatRate)}
                  </th>
                  <th className="border border-black/20 p-2 text-start">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-black/20 p-2">
                    {invoice.description || "خدمات إدارة أملاك"}
                  </td>
                  <td className="border border-black/20 p-2">{sar2(invoice.subtotal)}</td>
                  <td className="border border-black/20 p-2">{sar2(invoice.vatAmount)}</td>
                  <td className="border border-black/20 p-2 font-bold">{sar2(invoice.total)}</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-4 flex items-end justify-between gap-4">
              <div className="max-w-44">
                {qrImage ? (
                  <img
                    src={qrImage}
                    alt="رمز الفاتورة"
                    className="size-40 [image-rendering:pixelated]"
                  />
                ) : null}
                <p className="mt-1 text-[11px]">
                  رمز QR وفق متطلبات هيئة الزكاة والضريبة — يُقرأ بتطبيق التحقق من الفاتورة
                  الإلكترونية التابع للهيئة
                </p>
              </div>
              <div className="space-y-1 text-end">
                <p>الإجمالي قبل الضريبة: {sar2(invoice.subtotal)}</p>
                <p>ضريبة القيمة المضافة: {sar2(invoice.vatAmount)}</p>
                <p className="text-base font-bold">الإجمالي: {sar2(invoice.total)}</p>
              </div>
            </div>
          </div>
        )}

        {check ? (
          <div
            className={`mt-4 rounded-md border p-3 text-sm ${
              check.ok ? "border-primary/40 bg-accent" : "border-destructive/50"
            }`}
          >
            <p className="font-medium">
              {check.ok
                ? "الفاتورة مرّت فحص متطلبات هيئة الزكاة والضريبة ✓"
                : "الفاتورة لم تمر الفحص — صحّح ما يلي قبل التنزيل:"}
            </p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              {check.errors.map((e) => (
                <li key={e} className="text-destructive">
                  {e}
                </li>
              ))}
              {check.warnings.map((w) => (
                <li key={w} className="text-muted-foreground">
                  {w}
                </li>
              ))}
            </ul>
            {check.ok ? (
              <p className="mt-2 text-xs text-muted-foreground">
                رمز QR مشفّر بصيغة الهيئة (TLV): كاميرا الجوال تعرض نصًا فقط، ويقرؤه تطبيق التحقق من
                الفاتورة الإلكترونية ليعرض اسم المنشأة والرقم الضريبي والمبالغ.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
