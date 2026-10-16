import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { QrCode, FilePlus2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sar2, shortDate } from "@/lib/format";
import { myOrgId } from "@/lib/use-org-branding";

// The list is the index route, not an `invoices.tsx` parent: a parent with no <Outlet/> rendered
// this list on /invoices/new too, so the new-invoice form could never be reached.
export const Route = createFileRoute("/_authenticated/invoices/")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "الفواتير الإلكترونية — جارك" },
      {
        name: "description",
        content: "فواتير إلكترونية بحقول متطلبات هيئة الزكاة والضريبة: الرقم الضريبي والضريبة وQR.",
      },
      { property: "og:title", content: "الفواتير الإلكترونية — جارك" },
      { property: "og:description", content: "فواتير متوافقة مع متطلبات ZATCA." },
    ],
  }),
  component: Invoices,
});

const zatcaLabel: Record<string, string> = {
  draft: "مسودة",
  reported: "مُبلّغة",
  cleared: "مُصادق عليها",
  failed: "فشل الإرسال",
};

function Invoices() {
  const { data, isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const mine = await myOrgId();
      const orgQuery = supabase
        .from("org_settings")
        .select("company_name, vat_number, cr_number, vat_rate");
      const [invoices, org] = await Promise.all([
        supabase
          .from("invoices")
          .select(
            "id, invoice_number, customer_name, customer_vat_number, seller_name, seller_vat_number, issue_date, subtotal, vat_amount, total, qr_payload, zatca_status",
          )
          .order("issue_date", { ascending: false }),
        (mine ? orgQuery.eq("id", mine) : orgQuery.order("created_at", { ascending: true })).limit(
          1,
        ),
      ]);
      if (invoices.error) throw invoices.error;
      return { invoices: invoices.data ?? [], org: org.data?.[0] ?? null };
    },
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="الفواتير الإلكترونية" />
        <Skeleton className="h-64" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="الفواتير الإلكترونية"
        subtitle="فواتير بحقول ZATCA: بيانات المنشأة، الرقم الضريبي، تفصيل الضريبة، ورمز QR."
      />

      <Link to="/invoices/new" className="mb-6 inline-block">
        <Button>
          <FilePlus2 className="size-4" />
          إصدار فاتورة جديدة
        </Button>
      </Link>

      {data.org ? (
        <Card className="mb-6 shadow-deed">
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">المنشأة</p>
              <p className="font-medium">{data.org.company_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">الرقم الضريبي</p>
              <p className="font-medium" dir="ltr">
                {data.org.vat_number ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">السجل التجاري</p>
              <p className="font-medium" dir="ltr">
                {data.org.cr_number ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">نسبة الضريبة</p>
              <p className="font-medium">{data.org.vat_rate}%</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {data.invoices.map((inv) => (
          <Card key={inv.id} className="shadow-deed">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="font-display text-lg" dir="ltr">
                  {inv.invoice_number}
                </CardTitle>
                {/* "default" (red) is reserved for price/primary action/available — a ZATCA status
                    is none of those. */}
                <Badge variant={inv.zatca_status === "draft" ? "outline" : "secondary"}>
                  {zatcaLabel[inv.zatca_status] ?? inv.zatca_status}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{shortDate(inv.issue_date)}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">العميل</p>
                <p className="font-medium">{inv.customer_name}</p>
                {inv.customer_vat_number ? (
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    VAT {inv.customer_vat_number}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1 border-t border-border pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الإجمالي قبل الضريبة</span>
                  <span>{sar2(inv.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ضريبة القيمة المضافة</span>
                  <span>{sar2(inv.vat_amount)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>الإجمالي</span>
                  <span>{sar2(inv.total)}</span>
                </div>
              </div>
              {inv.qr_payload ? (
                <p className="flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <QrCode className="size-4 text-brass" />
                  رمز QR جاهز للطباعة على الفاتورة
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد فواتير.</p>
        ) : null}
      </div>
    </>
  );
}
