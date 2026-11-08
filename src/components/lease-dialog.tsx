import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LEASE_TERMS,
  MAX_LEASE_MONTHS,
  leaseEndDate,
  leaseSchedule,
  leaseStatusText,
  leaseTermFromEnd,
  nearestLeaseTerm,
} from "@/components/lease-schedule";
import { effectiveStatus, todayRiyadh } from "@/lib/dates";
import { arNum, monthsLabel, paymentStatusLabel, sar, shortDate } from "@/lib/format";
import { parseSaudiMobile } from "@/lib/public-form";
import { toLatinDigits, validateSaudiId } from "@/lib/saudi-id";

/** A lease's length in words: «سنة كاملة», «سنتان», «3 سنوات», «6 أشهر». */
function termText(months: number): string {
  if (months === 12) return "سنة كاملة";
  if (months === 24) return "سنتان";
  if (months % 12 === 0) return `${arNum(months / 12)} سنوات`;
  return monthsLabel(months);
}

/** Why a picked end date can't be used (null when it can). */
function endDateError(startDate: string, endDate: string): string | null {
  if (!endDate) return "حدّد تاريخ نهاية العقد";
  if (startDate && endDate <= startDate) return "تاريخ النهاية يجب أن يكون بعد تاريخ البداية";
  if (startDate && leaseTermFromEnd(startDate, endDate) === null)
    return `تاريخ النهاية يجب أن يُكمل أشهرًا كاملة من تاريخ البداية (حتى ${arNum(MAX_LEASE_MONTHS / 12)} سنوات)`;
  return null;
}

/**
 * «تاريخ نهاية العقد»: the office picks the contract's last day (as written on the contract); the
 * term in whole months follows from it. Quick picks fill common lengths.
 */
function LeaseEndField({
  id,
  startDate,
  endDate,
  onEndDate,
  error,
}: {
  id: string;
  startDate: string;
  endDate: string;
  onEndDate: (end: string) => void;
  error: string | null;
}) {
  const term = startDate ? leaseTermFromEnd(startDate, endDate) : null;
  const suggestion =
    startDate && endDate > startDate && term === null
      ? leaseEndDate(startDate, nearestLeaseTerm(startDate, endDate))
      : null;
  return (
    <Field id={id} label="تاريخ نهاية العقد" error={error}>
      <Input
        id={id}
        type="date"
        dir="ltr"
        min={startDate || undefined}
        value={endDate}
        onChange={(e) => onEndDate(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5">
        {LEASE_TERMS.map((t) => (
          <button
            key={t}
            type="button"
            disabled={!startDate}
            onClick={() => onEndDate(leaseEndDate(startDate, t))}
            className={`rounded-sm border px-2 py-0.5 text-xs ${
              term === t ? "border-foreground bg-foreground text-background" : "border-border"
            }`}
          >
            {termText(t)}
          </button>
        ))}
      </div>
      {term !== null ? (
        <p className="text-xs text-muted-foreground">
          مدة العقد: {termText(term)} — آخر يوم {shortDate(leaseEndDate(startDate, term))}
        </p>
      ) : suggestion ? (
        <button
          type="button"
          className="text-xs underline underline-offset-4"
          onClick={() => onEndDate(suggestion)}
        >
          استخدم أقرب تاريخ: {shortDate(suggestion)}
        </button>
      ) : null}
    </Field>
  );
}

const depositStatusLabel: Record<string, string> = {
  held: "محجوزة",
  refunded: "مستردة",
  deducted: "مخصومة",
  transferred: "منقولة للعقد المجدَّد",
};

/** Every screen that lists leases, payments or the unit's status. */
function invalidateLeaseViews(queryClient: QueryClient) {
  for (const key of [
    "leases",
    "lease-details",
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
}

/** A lease's terms and its payment schedule, opened from a row on /tenants. */
export function LeaseDetailsDialog({ leaseId, onClose }: { leaseId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<"end" | "correct" | "void" | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["lease-details", leaseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leases")
        .select(
          "id, start_date, end_date, annual_rent, term_months, installments, deposit, deposit_status, ejar_contract_no, ejar_status, status, moved_out_on, end_note, tenants(full_name, phone, national_id, email), units(unit_number, unit_name, unit_type, properties(name)), payments(id, amount, amount_paid, due_date, paid_date, status)",
        )
        .eq("id", leaseId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const voidLease = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("void_lease", { _lease_id: leaseId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُلغي العقد ودفعاته");
      invalidateLeaseViews(queryClient);
      onClose();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إلغاء العقد")),
  });

  const payments = [...(data?.payments ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const paid = payments.reduce((s, p) => s + Number(p.amount_paid), 0);
  const total = payments.reduce((s, p) => s + Number(p.amount), 0);
  // Correcting or voiding is for a lease entered by mistake: nothing paid on it yet.
  const untouched =
    payments.every((p) => p.status !== "paid" && Number(p.amount_paid) === 0) &&
    data?.deposit_status === "held";
  const label = data
    ? `${data.units?.properties?.name ?? ""} · وحدة ${data.units?.unit_number ?? "—"}`
    : "";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">تفاصيل العقد</DialogTitle>
          <DialogDescription>{data ? label : " "}</DialogDescription>
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
                <span className="ms-2 text-muted-foreground">({termText(data.term_months)})</span>
              </Item>
              <Item label="الحالة">
                <Badge variant={data.status === "active" ? "secondary" : "outline"}>
                  {leaseStatusText(data.status)}
                </Badge>
                {data.moved_out_on ? (
                  <span className="ms-2 text-muted-foreground">
                    أُخليت {shortDate(data.moved_out_on)}
                    {data.end_note ? ` · ${data.end_note}` : ""}
                  </span>
                ) : null}
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
                        {p.status !== "paid" && Number(p.amount_paid) > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            سُدد {sar(p.amount_paid)}
                          </span>
                        ) : null}
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

        <DialogFooter className="flex-wrap gap-2">
          {data?.status === "active" ? (
            <>
              <Button variant="outline" onClick={() => setAction("end")}>
                إنهاء العقد
              </Button>
              {untouched ? (
                <>
                  <Button variant="outline" onClick={() => setAction("correct")}>
                    تصحيح العقد
                  </Button>
                  <Button variant="outline" onClick={() => setAction("void")}>
                    إلغاء العقد
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>

      {data && action === "end" ? (
        <EndLeaseDialog
          lease={{ ...data, label }}
          onClose={() => setAction(null)}
          onDone={() => setAction(null)}
        />
      ) : null}
      {data && action === "correct" ? (
        <CorrectLeaseDialog
          lease={{ ...data, label }}
          onClose={() => setAction(null)}
          onDone={() => setAction(null)}
        />
      ) : null}
      {data && action === "void" ? (
        <Dialog open onOpenChange={(v) => !v && setAction(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>إلغاء العقد</DialogTitle>
              <DialogDescription>
                {label} — {data.tenants?.full_name ?? "—"}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">
              للعقود المُدخلة بالخطأ فقط: يُحذف العقد وكل دفعاته، وتعود الوحدة شاغرة (أو يعود العقد
              السابق ساريًا إن كان هذا تجديدًا له). لا يمكن التراجع.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAction(null)}>
                تراجع
              </Button>
              <Button
                variant="destructive"
                disabled={voidLease.isPending}
                onClick={() => voidLease.mutate()}
              >
                {voidLease.isPending ? "جارٍ الإلغاء…" : "إلغاء العقد نهائيًا"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Dialog>
  );
}

/**
 * «إنهاء العقد»: the tenant moved out (or is leaving early). Unpaid installments due after the
 * move-out are removed, the unit becomes vacant and the deposit stays held for settlement.
 */
export function EndLeaseDialog({
  lease,
  onClose,
  onDone,
}: {
  lease: { id: string; start_date: string; end_date: string; label: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const uid = useId();
  const today = todayRiyadh();
  const [moveOut, setMoveOut] = useState(today);
  const [reason, setReason] = useState<"ended" | "terminated">(
    lease.end_date <= today ? "ended" : "terminated",
  );
  const [note, setNote] = useState("");

  const moveOutError = !moveOut
    ? "حدّد تاريخ الإخلاء"
    : moveOut > today
      ? "تاريخ الإخلاء لا يكون في المستقبل — سجّل الإنهاء يوم الإخلاء"
      : moveOut < lease.start_date
        ? "تاريخ الإخلاء قبل بداية العقد"
        : null;

  const end = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("end_lease", {
        _lease_id: lease.id,
        _move_out: moveOut,
        _reason: reason,
        ...(note.trim() ? { _note: note.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُنهي العقد وأصبحت الوحدة شاغرة — سوِّ الوديعة من «التجديدات»");
      invalidateLeaseViews(queryClient);
      onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إنهاء العقد")),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">إنهاء العقد</DialogTitle>
          <DialogDescription>
            {lease.label} — ينتهي {shortDate(lease.end_date)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field id={`${uid}-reason`} label="سبب الإنهاء">
            <Select value={reason} onValueChange={(v) => setReason(v as "ended" | "terminated")}>
              <SelectTrigger id={`${uid}-reason`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ended">انتهاء مدة العقد</SelectItem>
                <SelectItem value="terminated">فسخ قبل نهاية المدة</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${uid}-move-out`} label="تاريخ الإخلاء" error={moveOutError}>
            <Input
              id={`${uid}-move-out`}
              type="date"
              dir="ltr"
              min={lease.start_date}
              max={today}
              value={moveOut}
              onChange={(e) => setMoveOut(e.target.value)}
              aria-invalid={Boolean(moveOutError)}
            />
          </Field>
          <Field id={`${uid}-note`} label="ملاحظة (اختياري)">
            <Textarea
              id={`${uid}-note`}
              rows={2}
              maxLength={400}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            تُلغى الدفعات غير المسددة المستحقة بعد تاريخ الإخلاء، وتصبح الوحدة شاغرة، وتبقى الوديعة
            محجوزة حتى تسويتها من «التجديدات». يصل إشعار للمستأجر والمالك.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button disabled={Boolean(moveOutError) || end.isPending} onClick={() => end.mutate()}>
            {end.isPending ? "جارٍ الإنهاء…" : "تأكيد الإنهاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «تصحيح العقد»: rewrite the terms of a lease that has nothing paid yet (a mistyped start year,
 * rent or term) and regenerate its schedule. `initial` prefills other terms, e.g. Ejar's.
 */
export function CorrectLeaseDialog({
  lease,
  initial,
  onClose,
  onDone,
}: {
  lease: {
    id: string;
    start_date: string;
    term_months: number;
    annual_rent: number;
    installments: number;
    deposit: number;
    deposit_status: string;
    label: string;
  };
  initial?: { startDate?: string; termMonths?: number; annualRent?: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [startDate, setStartDate] = useState(initial?.startDate ?? lease.start_date);
  const [endDate, setEndDate] = useState(() =>
    leaseEndDate(initial?.startDate ?? lease.start_date, initial?.termMonths ?? lease.term_months),
  );
  // A new start keeps the picked length: the end date moves with it.
  const changeStart = (next: string) => {
    const kept = leaseTermFromEnd(startDate, endDate);
    setStartDate(next);
    if (kept && next) setEndDate(leaseEndDate(next, kept));
  };
  const [annualRent, setAnnualRent] = useState(String(initial?.annualRent ?? lease.annual_rent));
  const [installments, setInstallments] = useState(String(lease.installments));
  const [depositText, setDepositText] = useState(String(lease.deposit));

  const term = (startDate && leaseTermFromEnd(startDate, endDate)) || 0;
  const rent = parseNumber(annualRent);
  const count = parseNumber(installments);
  const deposit = depositText.trim() ? parseNumber(depositText) : 0;
  const errors = {
    startDate: !startDate ? "حدّد تاريخ بداية العقد" : null,
    endDate: endDateError(startDate, endDate),
    rent:
      rent === null || rent <= 0
        ? "أدخل الإيجار السنوي بالريال"
        : Math.round(rent * 100) !== rent * 100
          ? "الإيجار بحد أقصى منزلتين عشريتين"
          : null,
    installments:
      count === null || !Number.isInteger(count) || count < 1 || count > 24
        ? "عدد الدفعات من 1 إلى 24"
        : term > 0 && count > term
          ? "عدد الدفعات لا يتجاوز مدة العقد بالأشهر"
          : null,
    deposit:
      deposit === null
        ? "أدخل مبلغ التأمين بالأرقام (0 إن لم يوجد)"
        : deposit !== Number(lease.deposit) && lease.deposit_status !== "held"
          ? "سبقت تسوية الوديعة — لا يتغير مبلغها"
          : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const schedule =
    valid && rent !== null && count !== null
      ? leaseSchedule({ startDate, termMonths: term, annualRent: rent, installments: count })
      : [];

  const correct = useMutation({
    mutationFn: async () => {
      if (!valid || rent === null || count === null || deposit === null) {
        throw new Error("أكمل بيانات العقد أولًا");
      }
      const { error } = await supabase.rpc("correct_lease", {
        _lease_id: lease.id,
        _start_date: startDate,
        _term_months: term,
        _annual_rent: rent,
        _installments: count,
        _deposit: deposit,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("صُحّح العقد وأُعيد إنشاء جدول دفعاته");
      invalidateLeaseViews(queryClient);
      onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تصحيح العقد")),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">تصحيح العقد</DialogTitle>
          <DialogDescription>
            {lease.label} — لعقد لم يُسدَّد منه شيء بعد. يُعاد إنشاء جدول الدفعات بالبيانات الجديدة.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${uid}-start`} label="تاريخ بداية العقد" error={errors.startDate}>
            <Input
              id={`${uid}-start`}
              type="date"
              dir="ltr"
              value={startDate}
              onChange={(e) => changeStart(e.target.value)}
            />
          </Field>
          <LeaseEndField
            id={`${uid}-end`}
            startDate={startDate}
            endDate={endDate}
            onEndDate={setEndDate}
            error={errors.endDate}
          />
          <Field id={`${uid}-rent`} label="الإيجار السنوي (ريال)" error={errors.rent}>
            <Input
              id={`${uid}-rent`}
              dir="ltr"
              inputMode="decimal"
              value={annualRent}
              onChange={(e) => setAnnualRent(e.target.value)}
            />
          </Field>
          <Field id={`${uid}-installments`} label="عدد الدفعات" error={errors.installments}>
            <Input
              id={`${uid}-installments`}
              dir="ltr"
              inputMode="numeric"
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
            />
          </Field>
          <Field id={`${uid}-deposit`} label="التأمين (ريال)" error={errors.deposit}>
            <Input
              id={`${uid}-deposit`}
              dir="ltr"
              inputMode="decimal"
              value={depositText}
              onChange={(e) => setDepositText(e.target.value)}
            />
          </Field>
          {schedule.length > 0 ? (
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-medium">جدول الدفعات الجديد</p>
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            تراجع
          </Button>
          <Button disabled={!valid || correct.isPending} onClick={() => correct.mutate()}>
            {correct.isPending ? "جارٍ الحفظ…" : "حفظ التصحيح"}
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
  endDate: "",
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
 * one, with its payment schedule, created by the create_lease RPC (same schedule as renew_lease;
 * one active lease per unit, and sync_unit_status then marks the unit occupied).
 */
export function NewLeaseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const uid = useId();
  const [form, setForm] = useState(emptyForm);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (open) {
      const today = todayRiyadh();
      setForm({ ...emptyForm, startDate: today, endDate: leaseEndDate(today, 12) });
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

  const term = (form.startDate && leaseTermFromEnd(form.startDate, form.endDate)) || 0;
  const rent = parseNumber(form.annualRent);
  const count = parseNumber(form.installments);
  const deposit = form.deposit.trim() ? parseNumber(form.deposit) : 0;
  const endDate = term > 0 ? leaseEndDate(form.startDate, term) : null;
  // A new start keeps the picked length: the end date moves with it.
  const changeStart = (next: string) =>
    setForm((f) => {
      const kept = leaseTermFromEnd(f.startDate, f.endDate);
      return {
        ...f,
        startDate: next,
        endDate: kept && next ? leaseEndDate(next, kept) : f.endDate,
      };
    });

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
    endDate: endDateError(form.startDate, form.endDate),
    rent:
      rent === null || rent <= 0
        ? "أدخل الإيجار السنوي بالريال"
        : Math.round(rent * 100) !== rent * 100
          ? "الإيجار بحد أقصى منزلتين عشريتين"
          : null,
    installments:
      count === null || !Number.isInteger(count) || count < 1 || count > 24
        ? "عدد الدفعات من 1 إلى 24"
        : term > 0 && count > term
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
      // One database transaction: the tenant (if new), the lease and its schedule are written
      // together or not at all, and the database refuses a second active lease on the unit.
      const { error } = await supabase.rpc("create_lease", {
        _unit_id: form.unitId,
        // create_lease takes NULL here for a new tenant; generated RPC types can't express a nullable arg.
        _tenant_id: form.tenantMode === "existing" ? form.tenantId : (null as unknown as string),
        _new_tenant:
          form.tenantMode === "new"
            ? {
                full_name: form.fullName.trim(),
                phone: form.phone.trim() ? parseSaudiMobile(form.phone) : null,
                national_id: form.nationalId.trim() ? toLatinDigits(form.nationalId.trim()) : null,
                email: form.email.trim() || null,
              }
            : null,
        _start_date: form.startDate,
        _term_months: term,
        _annual_rent: rent,
        _installments: count,
        _deposit: deposit,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُنشئ العقد وجدول دفعاته — وثّقه في «إيجار» ثم اربط رقمه");
      invalidateLeaseViews(queryClient);
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
              <Field id={`${uid}-unit`} label="الوحدة" error={show("unit", false)}>
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
                  <SelectTrigger id={`${uid}-unit`} aria-invalid={Boolean(show("unit", false))}>
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
              <Field
                id={`${uid}-tenant`}
                label="المستأجر"
                error={show("tenant", form.fullName.trim() !== "")}
              >
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
                    <SelectTrigger id={`${uid}-tenant`}>
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
                    id={`${uid}-tenant`}
                    value={form.fullName}
                    onChange={(e) => set("fullName", e.target.value)}
                    placeholder="الاسم الكامل كما في الهوية"
                  />
                )}
              </Field>
            </div>

            {form.tenantMode === "new" ? (
              <>
                <Field id={`${uid}-phone`} label="جوال المستأجر (اختياري)" error={errors.phone}>
                  <Input
                    id={`${uid}-phone`}
                    dir="ltr"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="05xxxxxxxx"
                  />
                </Field>
                <Field
                  id={`${uid}-national-id`}
                  label="رقم الهوية / الإقامة (اختياري)"
                  error={errors.nationalId}
                >
                  <Input
                    id={`${uid}-national-id`}
                    dir="ltr"
                    inputMode="numeric"
                    value={form.nationalId}
                    onChange={(e) => set("nationalId", e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    id={`${uid}-email`}
                    label="البريد الإلكتروني (اختياري)"
                    error={errors.email}
                  >
                    <Input
                      id={`${uid}-email`}
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

            <Field id={`${uid}-start`} label="تاريخ بداية العقد" error={show("startDate", false)}>
              <Input
                id={`${uid}-start`}
                type="date"
                dir="ltr"
                value={form.startDate}
                onChange={(e) => changeStart(e.target.value)}
              />
            </Field>
            <LeaseEndField
              id={`${uid}-end`}
              startDate={form.startDate}
              endDate={form.endDate}
              onEndDate={(v) => set("endDate", v)}
              error={show("endDate", form.endDate !== "")}
            />
            <Field
              id={`${uid}-rent`}
              label="الإيجار السنوي (ريال)"
              error={show("rent", form.annualRent.trim() !== "")}
            >
              <Input
                id={`${uid}-rent`}
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
              id={`${uid}-installments`}
              label="عدد الدفعات"
              error={show("installments", form.installments.trim() !== "")}
            >
              <Input
                id={`${uid}-installments`}
                dir="ltr"
                inputMode="numeric"
                value={form.installments}
                onChange={(e) => set("installments", e.target.value)}
              />
            </Field>
            <Field id={`${uid}-deposit`} label="التأمين (ريال)" error={errors.deposit}>
              <Input
                id={`${uid}-deposit`}
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

/** A labelled form row. `id` must also be set on the field's control, so the label names it and
 * clicking the label focuses it. */
function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
