import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { InvoicePreviewCard, type InvoiceView } from "@/components/invoice-preview";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgBranding } from "@/lib/use-org-branding";

export const Route = createFileRoute("/_authenticated/invoices/$invoiceId")({
  staticData: { sitemap: false },
  head: () => ({ meta: [{ title: "فاتورة — جارك" }] }),
  component: InvoiceDetail,
});

function InvoiceDetail() {
  const { invoiceId } = Route.useParams();
  const { org, logoDataUrl } = useOrgBranding();

  const invoice = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "invoice_number, customer_name, customer_vat_number, seller_name, seller_vat_number, description, issue_date, subtotal, vat_amount, total, qr_payload",
        )
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const row = invoice.data;
  const subtotal = Number(row?.subtotal ?? 0);
  const vatAmount = Number(row?.vat_amount ?? 0);
  const view: InvoiceView | null = row
    ? {
        invoiceNumber: row.invoice_number,
        customerName: row.customer_name,
        customerVat: row.customer_vat_number ?? "",
        description: row.description ?? "",
        issueDate: row.issue_date,
        subtotal,
        vatAmount,
        total: Number(row.total),
        qrPayload: row.qr_payload ?? "",
        sellerName: row.seller_name ?? "",
        sellerVat: row.seller_vat_number ?? "",
        crNumber: org.data?.cr_number ?? null,
        officeCode: org.data?.office_code ?? null,
        address: org.data?.address ?? null,
        // The rate the invoice was issued at, from its own amounts (the office may change it later).
        vatRate:
          subtotal > 0
            ? Math.round((vatAmount / subtotal) * 100)
            : Number(org.data?.vat_rate ?? 15),
      }
    : null;

  return (
    <>
      <PageHeader title={row ? `الفاتورة ${row.invoice_number}` : "الفاتورة"} />
      <Link
        to="/invoices"
        className="mb-4 inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-4 hover:text-red-text"
      >
        <ArrowRight className="size-4" />
        رجوع لسجل الفواتير
      </Link>
      {invoice.isLoading ? (
        <Skeleton className="h-96" />
      ) : !view ? (
        <p className="text-sm text-muted-foreground">
          {invoice.isError ? "تعذّر تحميل الفاتورة — حاول مرة أخرى" : "الفاتورة غير موجودة"}
        </p>
      ) : (
        <div className="max-w-2xl">
          <InvoicePreviewCard invoice={view} logoDataUrl={logoDataUrl} />
        </div>
      )}
    </>
  );
}
