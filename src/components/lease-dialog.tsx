import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEASE_TERMS, leaseEndDate, leaseSchedule } from "@/components/lease-schedule";
import { effectiveStatus, todayRiyadh } from "@/lib/dates";
import { arNum, leaseStatusLabel, paymentStatusLabel, sar, shortDate } from "@/lib/format";
import { parseSaudiMobile } from "@/lib/public-form";
import { toLatinDigits, validateSaudiId } from "@/lib/saudi-id";

const termLabel: Record<number, string> = {
  1: "شهر واحد",
  3: "3 أشهر",
  6: "6 أشهر",
  12: "سنة كاملة",
};

const depositStatusLabel: Record<string, string> = {
  held: "محجوزة",
  refunded: "مستردة",
  deducted: "مخصومة",
};

/** A lease's terms and its payment schedule, opened from a row on /tenants. */
export function LeaseDetailsDialog({ leaseId, onClose }: { leaseId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["lease-details", leaseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leases")
        .select(
          "id, start_date, end_date, annual_rent, term_months, installments, deposit, deposit_status, ejar_contract_no, ejar_status, status, tenants(full_name, phone, national_id, email), units(unit_number, unit_name, unit_type, properties(name)), payments(id, amount, due_date, paid_date, status)",
        )
        .eq("id", leaseId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const payments = [...(data?.payments ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const paid = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  const total = payments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">تفاصيل العقد</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.units?.properties?.name ?? ""} · وحدة ${data.units?.unit_number ?? "—"}`
              : " "}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : error || !data ? (
          <p className="text-sm text-destructive">تعذّر تحميل العقد.</p>
        ) : (
          <div className="space-y-5">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="المستأجر">
                {data.tenants?.full_name ?? "—"}
                {data.tenants?.phone ? (
                  <span className="ms-2 text-muted-foreground" dir="ltr">
                    {data.tenants.phone}
                  </span>
                ) : null}
              </Item>
              <Item label="الوحدة">
                {data.units?.properties?.name} · وحدة {data.units?.unit_number}
                {data.units?.unit_name ? ` · ${data.units.unit_name}` : ""}
              </Item>
              <Item label="المدة">
                {shortDate(data.start_date)} — {shortDate(data.end_date)}
                <span className="ms-2 text-muted-foreground">
                  ({termLabel[data.term_months] ?? `${data.term_months} أشهر`})
                </span>
              </Item>
              <Item label="الحالة">
                <Badge variant={data.status === "active" ? "secondary" : "outline"}>
                  {leaseStatusLabel[data.status] ?? data.status}
                </Badge>
              </Item>
              <Item label="الإيجار السنوي">{sar(data.annual_rent)}</Item>
              <Item label="عدد الدفعات">{arNum(data.installments)}</Item>
              <Item label="التأمين">
                {sar(data.deposit)}
                {Number(data.deposit) > 0 ? (
                  <span className="ms-2 text-muted-foreground">
                    ({depositStatusLabel[data.deposit_status] ?? data.deposit_status})
                  </span>
                ) : null}
              </Item>
              <Item label="رقم عقد «إيجار»">
                {data.ejar_contract_no ? (
                  <span dir="ltr">{data.ejar_contract_no}</span>
                ) : (
                  <span className="text-muted-foreground">لم يُوثَّق بعد</span>
                )}
              </Item>
            </dl>

            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">جدول الدفعات</p>
                <p className="text-xs text-muted-foreground">
                  المسدَّد {sar(paid)} من {sar(total)}
                </p>
              </div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {payments.map((p, i) => {
                  const status = effectiveStatus(p);
                  return (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span className="text-muted-foreground">
                        الدفعة {arNum(i + 1)} · {shortDate(p.due_date)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">{sar(p.amount)}</span>
                        <Badge
                          variant={
                            status === "overdue"
                              ? "destructive"
                              : status === "paid"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {paymentStatusLabel[status] ?? status}
                        </Badge>
                      </span>
                    </li>
                  );
                })}
                {payments.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground">
                    لا توجد دفعات على هذا العقد.
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

const emptyForm = {
  unitId: "",
  tenantMode: "existing" as "existing" | "new",
  tenantId: "",
  fullName: "",
  phone: "",
  nationalId: "",
  email: "",
  startDate: "",
  termMonths: "12",
  annualRent: "",
  installments: "4",
  deposit: "0",
};

/** Plain number from what was typed: Arabic-Indic digits and thousands separators are accepted. */
function parseNumber(value: string): number | null {
  const s = toLatinDigits(value)
    .replace(/[,٬\s]/g, "")
    .replace("٫", ".");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * «عقد جديد»: a first lease on a vacant rental unit, for an existing tenant of the office or a new
 * one, with its payment schedule. Built the same way renew_lease builds a renewal: one active lease
 * per unit (sync_unit_status then marks the unit occupied) and the rent split into installments.
 */
export function NewLeaseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) {
      setForm({ ...emptyForm, startDate: todayRiyadh() });
      setTried(false);
    }
  }, [open]);

  const options = useQuery({
    queryKey: ["new-lease-options"],
    enabled: open,
    queryFn: async () => {
      const [units, tenants] = await Promise.all([
        supabase
          .from("units")
          .select(
            "id, unit_number, unit_name, annual_rent, status, listing_purpose, properties(name)",
          )
          .order("unit_number"),
        supabase.from("tenants").select("id, full_name, phone").order("full_name"),
      ]);
      if (units.error) throw units.error;
      if (tenants.error) throw tenants.error;
      return {
        // A sale unit can never carry a lease (guard_no_lease_on_sale_unit); an occupied one
        // already has an active lease, which is renewed from «التجديدات» instead.
        units: units.data.filter(
          (u) => u.listing_purpose !== "sale" && u.status !== "occupied" && u.status !== "sold",
        ),
        tenants: tenants.data,
      };
    },
  });

  const term = Number(form.termMonths);
  const rent = parseNumber(form.annualRent);
  const count = parseNumber(form.installments);
  const deposit = form.deposit.trim() ? parseNumber(form.deposit) : 0;
  const endDate = form.startDate ? leaseEndDate(form.startDate, term) : null;

  const errors = {
    unit: !form.unitId ? "اختر الوحدة" : null,
    tenant:
      form.tenantMode === "existing"
        ? !form.tenantId
          ? "اختر المستأجر"
          : null
        : form.fullName.trim().length < 3
          ? "اكتب اسم المستأجر الكامل"
          : null,
    phone:
      form.tenantMode === "new" && form.phone.trim() && !parseSaudiMobile(form.phone)
        ? "رقم الجوال غير صحيح — مثال: 05xxxxxxxx"
        : null,
    nationalId:
      form.tenantMode === "new" && form.nationalId.trim()
        ? validateSaudiId(form.nationalId, "tenant")
        : null,
    email:
      form.tenantMode === "new" &&
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
        ? "البريد الإلكتروني غير صحيح"
        : null,
    startDate: !form.startDate ? "حدّد تاريخ بداية العقد" : null,
    rent:
      rent === null || rent <= 0
        ? "أدخل الإيجار السنوي بالريال"
        : Math.round(rent * 100) !== rent * 100
          ? "الإيجار بحد أقصى منزلتين عشريتين"
          : null,
    installments:
      count === null || !Number.isInteger(count) || count < 1 || count > 24
        ? "عدد الدفعات من 1 إلى 24"
        : count > term
          ? "عدد الدفعات لا يتجاوز مدة العقد بالأشهر"
          : null,
    deposit: deposit === null ? "أدخل مبلغ التأمين بالأرقام (0 إن لم يوجد)" : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  // Required-but-empty fields complain only after a save attempt; a wrong value says so at once.
  const show = (key: keyof typeof errors, touched: boolean) =>
    tried || touched ? errors[key] : null;

  const schedule =
    valid && rent !== null && count !== null
      ? leaseSchedule({
          startDate: form.startDate,
          termMonths: term,
          annualRent: rent,
          installments: count,
        })
      : [];

  const save = useMutation({
    mutationFn: async () => {
      if (!valid || rent === null || count === null || deposit === null || !endDate) {
        throw new Error("أكمل بيانات العقد أولًا");
      }
      // The unit list may be stale: never put a second active lease on a unit.
      const active = await supabase
        .from("leases")
        .select("id")
        .eq("unit_id", form.unitId)
        .eq("status", "active")
        .limit(1);
      if (active.error) throw active.error;
      if (active.data.length > 0) {
        throw new Error("على هذه الوحدة عقد ساري — جدّده من صفحة «التجديدات»");
      }

      let tenantId = form.tenantId;
      let createdTenant: string | null = null;
      if (form.tenantMode === "new") {
        // org_id is filled from the signed-in staff member's office (a_fill_org trigger).
        const { data, error } = await supabase
          .from("tenants")
          .insert({
            full_name: form.fullName.trim(),
            phone: form.phone.trim() ? parseSaudiMobile(form.phone) : null,
            national_id: form.nationalId.trim() ? toLatinDigits(form.nationalId.trim()) : null,
            email: form.email.trim() || null,
          })
          .select("id")
          .single();
        if (error) throw error;
        tenantId = data.id;
        createdTenant = data.id;
      }

      const lease = await supabase
        .from("leases")
        .insert({
          unit_id: form.unitId,
          tenant_id: tenantId,
          start_date: form.startDate,
          end_date: endDate,
          annual_rent: rent,
          term_months: term,
          installments: count,
          deposit,
          status: "active",
          ejar_status: "pending",
        })
        .select("id")
        .single();
      if (lease.error) {
        if (createdTenant) await supabase.from("tenants").delete().eq("id", createdTenant);
        throw lease.error;
      }

      const rows = leaseSchedule({
        startDate: form.startDate,
        termMonths: term,
        annualRent: rent,
        installments: count,
      }).map((p) => ({ ...p, lease_id: lease.data.id, status: "due" }));
      const payments = await supabase.from("payments").insert(rows);
      if (payments.error) {
        // No lease without its schedule: undo, so a retry starts clean.
        await supabase.from("leases").delete().eq("id", lease.data.id);
        if (createdTenant) await supabase.from("tenants").delete().eq("id", createdTenant);
        throw payments.error;
      }
    },
    onSuccess: () => {
      toast.success("أُنشئ العقد وجدول دفعاته — وثّقه في «إيجار» ثم اربط رقمه");
      for (const key of [
        "leases",
        "ejar-leases",
        "properties-with-units",
        "collections",
        "dashboard",
        "renewals",
        "deposit-leases",
        "new-lease-options",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إنشاء العقد")),
  });

  const units = options.data?.units ?? [];
  const tenants = options.data?.tenants ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">عقد جديد</DialogTitle>
          <DialogDescription>
            عقد إيجار على وحدة شاغرة؛ تُنشأ دفعاته تلقائيًا وتصبح الوحدة مشغولة.
          </DialogDescription>
        </DialogHeader>

        {options.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="الوحدة" error={show("unit", false)}>
                <Select
                  value={form.unitId}
                  onValueChange={(v) => {
                    set("unitId", v);
                    const unit = units.find((u) => u.id === v);
                    if (unit && !form.annualRent && Number(unit.annual_rent) > 0) {
                      set("annualRent", String(unit.annual_rent));
                    }
                  }}
                >
                  <SelectTrigger aria-invalid={Boolean(show("unit", false))}>
                    <SelectValue placeholder="اختر وحدة شاغرة" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.properties?.name} · وحدة {u.unit_number}
                        {u.unit_name ? ` · ${u.unit_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {units.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    لا توجد وحدات إيجار شاغرة — سجّل وحدة من «الأملاك والوحدات».
                  </p>
                ) : null}
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="المستأجر" error={show("tenant", form.fullName.trim() !== "")}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={form.tenantMode === "existing" ? "secondary" : "outline"}
                    aria-pressed={form.tenantMode === "existing"}
                    onClick={() => set("tenantMode", "existing")}
                  >
                    مستأجر مسجّل
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.tenantMode === "new" ? "secondary" : "outline"}
                    aria-pressed={form.tenantMode === "new"}
                    onClick={() => set("tenantMode", "new")}
                  >
                    مستأجر جديد
                  </Button>
                </div>
                {form.tenantMode === "existing" ? (
                  <Select value={form.tenantId} onValueChange={(v) => set("tenantId", v)}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={tenants.length ? "اختر المستأجر" : "لا يوجد مستأجرون بعد"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.full_name}
                          {t.phone ? ` · ${t.phone}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={form.fullName}
                    onChange={(e) => set("fullName", e.target.value)}
                    placeholder="الاسم الكامل كما في الهوية"
                  />
                )}
              </Field>
            </div>

            {form.tenantMode === "new" ? (
              <>
                <Field label="جوال المستأجر (اختياري)" error={errors.phone}>
                  <Input
                    dir="ltr"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="05xxxxxxxx"
                  />
                </Field>
                <Field label="رقم الهوية / الإقامة (اختياري)" error={errors.nationalId}>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    value={form.nationalId}
                    onChange={(e) => set("nationalId", e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="البريد الإلكتروني (اختياري)" error={errors.email}>
                    <Input
                      dir="ltr"
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="tenant@example.com"
                    />
                  </Field>
                </div>
              </>
            ) : null}

            <Field label="تاريخ بداية العقد" error={show("startDate", false)}>
              <Input
                type="date"
                dir="ltr"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </Field>
            <Field label="مدة العقد">
              <Select value={form.termMonths} onValueChange={(v) => set("termMonths", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEASE_TERMS.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      {termLabel[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {endDate ? (
                <p className="text-xs text-muted-foreground">ينتهي في {shortDate(endDate)}</p>
              ) : null}
            </Field>
            <Field
              label="الإيجار السنوي (ريال)"
              error={show("rent", form.annualRent.trim() !== "")}
            >
              <Input
                dir="ltr"
                inputMode="decimal"
                value={form.annualRent}
                onChange={(e) => set("annualRent", e.target.value)}
              />
              {term !== 12 ? (
                <p className="text-xs text-muted-foreground">
                  يُحصَّل من الإيجار السنوي ما يعادل مدة العقد فقط.
                </p>
              ) : null}
            </Field>
            <Field
              label="عدد الدفعات"
              error={show("installments", form.installments.trim() !== "")}
            >
              <Input
                dir="ltr"
                inputMode="numeric"
                value={form.installments}
                onChange={(e) => set("installments", e.target.value)}
              />
            </Field>
            <Field label="التأمين (ريال)" error={errors.deposit}>
              <Input
                dir="ltr"
                inputMode="decimal"
                value={form.deposit}
                onChange={(e) => set("deposit", e.target.value)}
              />
            </Field>

            {schedule.length > 0 ? (
              <div className="sm:col-span-2">
                <p className="mb-2 text-sm font-medium">جدول الدفعات</p>
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                  {schedule.map((p, i) => (
                    <li key={p.due_date} className="flex justify-between gap-2 px-3 py-2">
                      <span className="text-muted-foreground">
                        الدفعة {arNum(i + 1)} · {shortDate(p.due_date)}
                      </span>
                      <span className="font-medium tabular-nums">{sar(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            onClick={() => {
              setTried(true);
              if (valid) save.mutate();
            }}
            disabled={save.isPending || options.isLoading || (tried && !valid)}
          >
            {save.isPending ? "جارٍ الإنشاء..." : "إنشاء العقد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
