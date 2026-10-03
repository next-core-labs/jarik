import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Wallet } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { sar, shortDate } from "@/lib/format";
import { daysBetween, todayRiyadh } from "@/lib/dates";
import { downloadElementAsPdf } from "@/lib/pdf";

const depositLabel: Record<string, string> = {
  held: "محجوزة",
  refunded: "مستردة",
  deducted: "مخصومة",
};

/** بطاقة المستأجر: ملخص العقد الحالي — المدة، الإيجار، الوديعة، حالة توثيق إيجار، وتنزيل ملخص PDF. */
export function ContractCard({ leaseId }: { leaseId: string }) {
  const pdfRef = useRef<HTMLDivElement>(null);
  const [showPdfNode, setShowPdfNode] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-contract-card", leaseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leases")
        .select(
          "id, start_date, end_date, annual_rent, term_months, deposit, deposit_status, deposit_note, ejar_status, ejar_contract_no, units(unit_number, properties(name))",
        )
        .eq("id", leaseId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const downloadContractPdf = async () => {
    if (!data) return;
    setShowPdfNode(true);
    await new Promise((r) => setTimeout(r, 120));
    if (!pdfRef.current) return;
    try {
      await downloadElementAsPdf(pdfRef.current, `ملخص-عقد-${data.units?.unit_number ?? ""}.pdf`);
      toast.success("نزل ملخص العقد PDF");
    } catch {
      toast.error("تعذّر إنشاء الملف");
    } finally {
      setShowPdfNode(false);
    }
  };

  if (isLoading) return <Skeleton className="h-40" />;

  if (!data) {
    return (
      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">العقد</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">تعذّر العثور على العقد.</p>
        </CardContent>
      </Card>
    );
  }

  const propertyName = data.units?.properties?.name ?? "";
  const unitNumber = data.units?.unit_number ?? "";

  const total = daysBetween(data.start_date, data.end_date);
  const elapsedRaw = daysBetween(data.start_date, todayRiyadh());
  const elapsed = Math.min(Math.max(elapsedRaw, 0), total);
  const pct = Math.min(Math.max(total > 0 ? Math.round((elapsed / total) * 100) : 0, 0), 100);

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4 text-brass" />
            {propertyName} · وحدة {unitNumber}
          </CardTitle>
          <div className="flex items-center gap-2">
            {data.term_months && data.term_months !== 12 ? (
              <Badge variant="outline">عقد {data.term_months} أشهر</Badge>
            ) : null}
            {data.ejar_status === "synced" ? (
              <Badge variant="secondary" dir={data.ejar_contract_no ? "ltr" : undefined}>
                {data.ejar_contract_no ?? "موثّق"}
              </Badge>
            ) : (
              <Badge variant="outline">بانتظار توثيق إيجار</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Progress value={pct} />
          <p className="text-sm text-muted-foreground">
            {shortDate(data.start_date)} — {shortDate(data.end_date)} · مضى{" "}
            {Math.floor(elapsed / 30)} من {Math.floor(total / 30)} شهرًا
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm">
            <Wallet className="size-4 text-muted-foreground" />
            <span>الإيجار السنوي {sar(data.annual_rent)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Wallet className="size-4 text-muted-foreground" />
            <span>
              الوديعة {sar(data.deposit)} —{" "}
              {depositLabel[data.deposit_status] ?? data.deposit_status}
              {data.deposit_note ? ` (${data.deposit_note})` : ""}
            </span>
          </div>
        </div>
        <Button variant="outline" onClick={downloadContractPdf} disabled={showPdfNode}>
          <Download className="size-4" />
          تحميل العقد PDF
        </Button>
      </CardContent>
      {showPdfNode ? (
        <div
          ref={pdfRef}
          dir="rtl"
          className="pointer-events-none fixed -left-[10000px] top-0 w-[700px] bg-white p-8 text-black"
          aria-hidden="true"
        >
          <p className="text-lg font-bold">ملخص العقد — جارك</p>
          <table className="mt-6 w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2 text-gray-600">العقار والوحدة</td>
                <td className="py-2 text-left font-bold">
                  {propertyName} · وحدة {unitNumber}
                </td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">المدة</td>
                <td className="py-2 text-left font-bold">
                  {shortDate(data.start_date)} — {shortDate(data.end_date)}
                </td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">الإيجار السنوي</td>
                <td className="py-2 text-left font-bold">{sar(data.annual_rent)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">الوديعة</td>
                <td className="py-2 text-left font-bold">{sar(data.deposit)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">رقم عقد إيجار</td>
                <td className="py-2 text-left font-bold" dir="ltr">
                  {data.ejar_contract_no ?? "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
