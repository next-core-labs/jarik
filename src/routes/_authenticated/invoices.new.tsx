import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ArrowRight, Calculator, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayRiyadh } from "@/lib/dates";
import { arPct, sar2 } from "@/lib/format";
import { parseAmount } from "@/lib/public-form";
import { toLatinDigits } from "@/lib/saudi-id";
import { validateImageFile } from "@/lib/unit-photos";
import { addVat, buildZatcaQrPayload, splitVat } from "@/lib/zatca";
import { useOrgBranding } from "@/lib/use-org-branding";
import { InvoicePreviewCard, type InvoiceView } from "@/components/invoice-preview";

export const Route = createFileRoute("/_authenticated/invoices/new")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "إصدار فاتورة إلكترونية — جارك" },
      {
        name: "description",
        content:
          "إصدار فاتورة ضريبية مبسطة متوافقة مع متطلبات هيئة الزكاة والضريبة وتنزيلها كملف PDF.",
      },
      { property: "og:title", content: "إصدار فاتورة إلكترونية — جارك" },
      { property: "og:description", content: "فاتورة ZATCA مع رمز QR وتنزيل PDF مباشر." },
    ],
  }),
  component: NewInvoice,
});

type Issued = Omit<InvoiceView, "address">;

function NewInvoice() {
  const [customerName, setCustomerName] = useState("");
  const [customerVat, setCustomerVat] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [amountIncludesVat, setAmountIncludesVat] = useState("yes");
  const [leaseId, setLeaseId] = useState("");
  const [issueDate, setIssueDate] = useState(todayRiyadh());
  const [issued, setIssued] = useState<Issued | null>(null);
  const [vatNumberInput, setVatNumberInput] = useState<string | null>(null);
  const [crNumberInput, setCrNumberInput] = useState<string | null>(null);
  const [officeCodeInput, setOfficeCodeInput] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const { org, logoDataUrl } = useOrgBranding();

  const leases = useQuery({
    queryKey: ["invoice-leases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leases")
        .select("id, tenants(full_name), units(id, unit_number, properties(name))")
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
  });

  const calcUtilities = useMutation({
    mutationFn: async () => {
      const lease = (leases.data ?? []).find((l) => l.id === leaseId);
      const unitId = lease?.units?.id;
      if (!unitId) throw new Error("no-unit");
      const { data: readings, error } = await supabase
        .from("meter_readings")
        .select("meter_type, reading, reading_date")
        .eq("unit_id", unitId)
        .order("reading_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      const latest: Record<string, { reading: number; date: string }[]> = {};
      for (const r of readings ?? []) {
        (latest[r.meter_type] ??= []).push({ reading: Number(r.reading), date: r.reading_date });
      }
      const parts: string[] = [];
      let total = 0;
      const rates: Record<string, { rate: number; label: string }> = {
        electricity: { rate: Number(org.data?.electricity_rate ?? 0.18), label: "الكهرباء" },
        water: { rate: Number(org.data?.water_rate ?? 6), label: "المياه" },
      };
      for (const [type, cfg] of Object.entries(rates)) {
        const list = latest[type] ?? [];
        const [latestReading, previousReading] = list;
        if (latestReading && previousReading) {
          const consumption = Math.max(0, latestReading.reading - previousReading.reading);
          const amountFor = consumption * cfg.rate;
          total += amountFor;
          parts.push(
            `استهلاك ${cfg.label}: ${consumption} ${type === "electricity" ? "ك.و.س" : "م³"} × ${cfg.rate} ريال = ${amountFor.toFixed(2)} ريال (من ${previousReading.date} إلى ${latestReading.date})`,
          );
        }
      }
      if (!parts.length) throw new Error("no-readings");
      return {
        total,
        text: `فاتورة خدمات — وحدة ${lease?.units?.unit_number ?? ""}\n${parts.join("\n")}`,
      };
    },
    onSuccess: ({ total, text }) => {
      setAmount(total.toFixed(2));
      setDescription(text);
      toast.success("احتُسب الاستهلاك من آخر قراءتين مسجلتين");
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message === "no-unit"
          ? "اختر عقدًا مرتبطًا بوحدة أولًا"
          : "لا توجد قراءتان على الأقل لعدّاد واحد في هذه الوحدة",
      ),
  });

  // The seller VAT number prints on every ZATCA invoice: 15 digits, starting and ending with 3.
  const vatDraft = toLatinDigits(vatNumberInput ?? org.data?.vat_number ?? "").replace(/\s/g, "");
  const vatDraftError =
    vatDraft && !/^3\d{13}3$/.test(vatDraft)
      ? "الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ3 — مثال: 300000000000003"
      : null;

  const saveBranding = useMutation({
    mutationFn: async (patch: {
      vat_number?: string | null;
      cr_number?: string | null;
      office_code?: string | null;
      logo_url?: string;
    }) => {
      if (!org.data) throw new Error("لا توجد إعدادات منشأة");
      if (patch.vat_number !== undefined && vatDraftError) throw new Error(vatDraftError);
      const { error } = await supabase.from("org_settings").update(patch).eq("id", org.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ بيانات المنشأة");
      void org.refetch();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحفظ")),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      if (!org.data) throw new Error("لا توجد إعدادات منشأة");
      const problem = validateImageFile(file);
      if (problem) throw new Error(problem);
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      // The branding bucket only accepts files inside the office's own folder.
      const path = `${org.data.id}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("branding")
        .upload(path, file, { upsert: true });
      if (error) throw error;
      await saveBranding.mutateAsync({ logo_url: path });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر رفع الشعار")),
  });

  // Live breakdown while typing; the issue mutation uses the same numbers.
  const vatRate = Number(org.data?.vat_rate ?? 15);
  const parsedAmount = parseAmount(amount);
  const amountValid = parsedAmount != null && parsedAmount > 0;
  const totals = amountValid
    ? amountIncludesVat === "yes"
      ? splitVat(parsedAmount, vatRate)
      : addVat(parsedAmount, vatRate)
    : null;

  const issue = useMutation({
    mutationFn: async () => {
      if (!totals) throw new Error("أدخل مبلغًا صحيحًا");
      if (!org.data) throw new Error("لا توجد إعدادات منشأة");
      const sellerName = org.data.company_name ?? "";
      // The VAT number typed under «بيانات المنشأة على الفاتورة» counts even before «حفظ البيانات».
      const sellerVat = vatDraft;
      if (!sellerVat)
        throw new Error("أدخل الرقم الضريبي للمنشأة في «بيانات المنشأة على الفاتورة» أدناه");
      if (vatDraftError) throw new Error(vatDraftError);
      const crDraft = (crNumberInput ?? org.data.cr_number ?? "").trim() || null;
      const codeDraft = (officeCodeInput ?? org.data.office_code ?? "").trim() || null;
      if (
        sellerVat !== (org.data.vat_number ?? "") ||
        crDraft !== (org.data.cr_number ?? null) ||
        codeDraft !== (org.data.office_code ?? null)
      ) {
        const { error: saveError } = await supabase
          .from("org_settings")
          .update({ vat_number: sellerVat, cr_number: crDraft, office_code: codeDraft })
          .eq("id", org.data.id);
        if (saveError) throw saveError;
        void org.refetch();
      }

      const issueTimestamp = new Date(
        `${issueDate}T${new Date().toTimeString().slice(0, 8)}`,
      ).toISOString();

      // Build the QR first: it can throw (e.g. a seller name over 255 bytes), and the invoice
      // number below must not be used up by an invoice that never gets saved.
      const qrPayload = buildZatcaQrPayload({
        sellerName,
        sellerVatNumber: sellerVat,
        issueDate: issueTimestamp,
        total: totals.total,
        vatAmount: totals.vatAmount,
      });

      // The number comes from the database (locked counter), never from counting rows in the
      // browser: two staff issuing at once used to get the same number.
      const { data: invoiceNumber, error: numberError } = await supabase.rpc(
        "next_invoice_number",
        {
          _year: Number(issueDate.slice(0, 4)),
        },
      );
      if (numberError || !invoiceNumber)
        throw new Error("تعذّر توليد رقم الفاتورة — حاول مرة أخرى");

      const { error } = await supabase.from("invoices").insert({
        invoice_number: invoiceNumber,
        customer_name: customerName.trim(),
        customer_vat_number: customerVat.trim() || null,
        seller_name: sellerName,
        seller_vat_number: sellerVat,
        description: description.trim() || null,
        lease_id: leaseId || null,
        issue_date: issueTimestamp,
        subtotal: totals.subtotal,
        vat_amount: totals.vatAmount,
        total: totals.total,
        qr_payload: qrPayload,
        zatca_status: "draft",
      });
      if (error) throw error;

      return {
        invoiceNumber,
        customerName: customerName.trim(),
        customerVat: customerVat.trim(),
        description: description.trim(),
        issueDate: issueTimestamp,
        ...totals,
        qrPayload,
        sellerName,
        sellerVat,
        crNumber: crDraft,
        officeCode: codeDraft,
        vatRate,
      } satisfies Issued;
    },
    onSuccess: (result) => {
      setIssued(result);
      toast.success(`صُدرت الفاتورة ${result.invoiceNumber}`);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إصدار الفاتورة")),
  });

  return (
    <>
      <PageHeader
        title="إصدار فاتورة إلكترونية"
        subtitle="فاتورة ضريبية مبسطة بحقول هيئة الزكاة والضريبة ورمز QR، وتنزيل مباشر كملف PDF."
      />

      <Link
        to="/invoices"
        className="mb-4 inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-4 hover:text-red-text"
      >
        <ArrowRight className="size-4" />
        رجوع لسجل الفواتير
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-deed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FilePlus2 className="size-4 text-brass" />
              بيانات الفاتورة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>اسم العميل</Label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div>
              <Label>الرقم الضريبي للعميل (اختياري)</Label>
              <Input
                dir="ltr"
                value={customerVat}
                onChange={(e) => setCustomerVat(e.target.value)}
              />
            </div>
            <div>
              <Label>العقد المرتبط (اختياري)</Label>
              <Select value={leaseId} onValueChange={setLeaseId}>
                <SelectTrigger>
                  <SelectValue placeholder="بدون ربط" />
                </SelectTrigger>
                <SelectContent>
                  {(leases.data ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.tenants?.full_name} · {l.units?.properties?.name} · وحدة{" "}
                      {l.units?.unit_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={!leaseId || calcUtilities.isPending}
                onClick={() => calcUtilities.mutate()}
              >
                <Calculator className="size-4" />
                {calcUtilities.isPending ? "جارٍ الاحتساب…" : "احتساب الكهرباء والمياه من العدادات"}
              </Button>
            </div>
            <div>
              <Label>وصف البند</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="إيجار الدفعة الأولى — وحدة 101"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>المبلغ</Label>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="23000"
                />
              </div>
              <div>
                <Label>المبلغ يشمل الضريبة؟</Label>
                <Select value={amountIncludesVat} onValueChange={setAmountIncludesVat}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yes">نعم، شامل الضريبة</SelectItem>
                    <SelectItem value="no">لا، قبل الضريبة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {amount.trim() ? (
                <div className="text-sm sm:col-span-2" aria-live="polite">
                  {totals ? (
                    <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-3">
                      <div>
                        <dt className="text-xs text-muted-foreground">قبل الضريبة</dt>
                        <dd>{sar2(totals.subtotal)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          الضريبة ({arPct(vatRate)})
                        </dt>
                        <dd>{sar2(totals.vatAmount)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">الإجمالي</dt>
                        <dd className="font-bold">{sar2(totals.total)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-destructive">أدخل مبلغًا صحيحًا</p>
                  )}
                </div>
              ) : null}
              <div>
                <Label>تاريخ الإصدار</Label>
                <Input
                  type="date"
                  dir="ltr"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={!customerName.trim() || !amount || issue.isPending}
                  onClick={() => issue.mutate()}
                >
                  إصدار الفاتورة
                </Button>
              </div>
            </div>
            <div className="space-y-3 rounded-md border border-dashed border-border p-4">
              <p className="font-medium">بيانات المنشأة على الفاتورة</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="seller-vat">الرقم الضريبي</Label>
                  <Input
                    id="seller-vat"
                    dir="ltr"
                    inputMode="numeric"
                    value={vatNumberInput ?? org.data?.vat_number ?? ""}
                    onChange={(e) => setVatNumberInput(e.target.value)}
                    placeholder="300000000000003"
                    aria-invalid={Boolean(vatDraftError)}
                  />
                  {vatDraftError ? (
                    <p className="mt-1 text-xs text-destructive">{vatDraftError}</p>
                  ) : null}
                </div>
                <div>
                  <Label>السجل التجاري</Label>
                  <Input
                    dir="ltr"
                    value={crNumberInput ?? org.data?.cr_number ?? ""}
                    onChange={(e) => setCrNumberInput(e.target.value)}
                    placeholder="1010123456"
                  />
                </div>
                <div>
                  <Label>شفرة المكتب</Label>
                  <Input
                    dir="ltr"
                    value={officeCodeInput ?? org.data?.office_code ?? ""}
                    onChange={(e) => setOfficeCodeInput(e.target.value)}
                    placeholder="مثال: RE-1234"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saveBranding.isPending || Boolean(vatDraftError)}
                  onClick={() =>
                    saveBranding.mutate({
                      vat_number: vatDraft || null,
                      cr_number: (crNumberInput ?? org.data?.cr_number ?? "").trim() || null,
                      office_code: (officeCodeInput ?? org.data?.office_code ?? "").trim() || null,
                    })
                  }
                >
                  حفظ البيانات
                </Button>
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  aria-label="شعار المنشأة على الفاتورة"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogo.mutate(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploadLogo.isPending}
                  onClick={() => logoRef.current?.click()}
                >
                  {logoDataUrl ? "تغيير الشعار" : "رفع الشعار"}
                </Button>
                {logoDataUrl ? (
                  <img src={logoDataUrl} alt="شعار المنشأة" className="h-10 w-auto" />
                ) : (
                  <span className="text-xs text-muted-foreground">لم يُرفع شعار بعد</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <InvoicePreviewCard
          invoice={issued ? { ...issued, address: org.data?.address ?? null } : null}
          logoDataUrl={logoDataUrl}
        />
      </div>
    </>
  );
}
