import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, CalendarClock, CalendarPlus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addDays } from "@/lib/dates";
import { sar, shortDate, daysUntil } from "@/lib/format";
import { depositSettleable, settleDeposit } from "@/lib/office-tools.functions";
import { parseAmount } from "@/lib/public-form";
import { suggestRent } from "@/lib/pricing.functions";

export const Route = createFileRoute("/_authenticated/renewals")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "تجديد العقود — جارك" },
      {
        name: "description",
        content: "العقود القريبة من الانتهاء خلال 90 يومًا مع تجديد العقد وإنشاء دفعاته بضغطة.",
      },
      { property: "og:title", content: "تجديد العقود — جارك" },
      { property: "og:description", content: "تابع العقود القريبة من الانتهاء وجدّدها بضغطة." },
    ],
  }),
  component: Renewals,
});

type RenewalLease = {
  id: string;
  unit_id: string;
  tenant_id: string;
  end_date: string;
  annual_rent: number;
  installments: number;
  deposit: number;
  tenants: { full_name: string; phone: string | null } | null;
  units: {
    unit_number: string;
    unit_name: string | null;
    unit_type: string;
    district: string | null;
    floor_no: string | null;
    rooms: number | null;
    halls: number | null;
    bathrooms: number | null;
    area: number | null;
    furnished: boolean;
    properties: { name: string } | null;
  } | null;
};

function Renewals() {
  const queryClient = useQueryClient();
  const [renewing, setRenewing] = useState<RenewalLease | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRenewing, setBulkRenewing] = useState<RenewalLease[] | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["renewals"],
    queryFn: async () => {
      const { data: leases, error } = await supabase
        .from("leases")
        .select(
          "id, unit_id, tenant_id, end_date, annual_rent, installments, deposit, tenants(full_name, phone), units(unit_number, unit_name, unit_type, district, floor_no, rooms, halls, bathrooms, area, furnished, properties(name))",
        )
        .eq("status", "active")
        .order("end_date");
      if (error) throw error;
      const rows = (leases ?? []) as unknown as RenewalLease[];
      return rows.filter((l) => daysUntil(l.end_date) <= 90);
    },
  });

  const remind = useMutation({
    mutationFn: async () => {
      const { data: n, error } = await supabase.rpc("notify_expiring_leases", { _days: 90 });
      if (error) throw error;
      return Number(n ?? 0);
    },
    onSuccess: (n) => {
      toast.success(
        n > 0 ? `تم إرسال تنبيهات تجديد لـ ${n} عقد` : "لا توجد عقود تنتهي خلال 90 يومًا",
      );
      queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الإرسال")),
  });

  const list = data ?? [];
  const selectedLeases = list.filter((l) => selectedIds.has(l.id));

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title="تجديد العقود"
        subtitle="العقود السارية التي تنتهي خلال 90 يومًا (أو انتهت ولم تُجدَّد)، مرتّبة من الأقرب انتهاءً."
        action={
          <div className="flex flex-wrap gap-2">
            {selectedLeases.length > 0 ? (
              <Button onClick={() => setBulkRenewing(selectedLeases)}>
                <CalendarPlus className="size-4" />
                تجديد المحدد ({selectedLeases.length})
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => remind.mutate()} disabled={remind.isPending}>
              <BellRing className="size-4" />
              تنبيه الملاك والمستأجرين
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-4">
          {list.map((l) => {
            const days = daysUntil(l.end_date);
            return (
              <Card key={l.id} className="shadow-deed">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className="mt-2"
                        checked={selectedIds.has(l.id)}
                        onCheckedChange={(v) => toggleSelected(l.id, v === true)}
                        aria-label="تحديد العقد للتجديد الجماعي"
                      />
                      <span className="grid size-10 place-items-center rounded-md bg-muted text-brass">
                        <CalendarClock className="size-5" />
                      </span>
                      <div>
                        <CardTitle className="text-base font-display">
                          {l.units?.properties?.name} · وحدة {l.units?.unit_number}
                          {l.units?.unit_name ? ` · ${l.units.unit_name}` : ""}
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          المستأجر: {l.tenants?.full_name ?? "—"}
                          {l.tenants?.phone ? ` · ${l.tenants.phone}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge
                        variant={days < 0 ? "destructive" : days <= 30 ? "secondary" : "outline"}
                      >
                        {days < 0 ? `منتهٍ منذ ${Math.abs(days)} يوم` : `ينتهي بعد ${days} يوم`}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {shortDate(l.end_date)} · {sar(l.annual_rent)}
                      </span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button onClick={() => setRenewing(l)}>
                    <CalendarPlus className="size-4" />
                    جدّد العقد
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد عقود قريبة من الانتهاء.</p>
          ) : null}
        </div>
      )}

      <div className="mt-6 space-y-4">
        <OwnerDecisionsSection />
        <RenewalRequestsSection />
        <DepositsSection />
      </div>

      {renewing ? (
        <RenewDialog
          lease={renewing}
          onClose={() => setRenewing(null)}
          onDone={() => {
            setRenewing(null);
            queryClient.invalidateQueries({ queryKey: ["renewals"] });
            queryClient.invalidateQueries({ queryKey: ["leases"] });
          }}
        />
      ) : null}

      {bulkRenewing ? (
        <BulkRenewDialog
          leases={bulkRenewing}
          onClose={() => setBulkRenewing(null)}
          onDone={() => {
            setBulkRenewing(null);
            setSelectedIds(new Set());
            queryClient.invalidateQueries({ queryKey: ["renewals"] });
            queryClient.invalidateQueries({ queryKey: ["leases"] });
          }}
        />
      ) : null}
    </>
  );
}

function RenewDialog({
  lease,
  onClose,
  onDone,
}: {
  lease: RenewalLease;
  onClose: () => void;
  onDone: () => void;
}) {
  const [startDate, setStartDate] = useState(addDays(lease.end_date, 1));
  const [rent, setRent] = useState(String(lease.annual_rent));
  const [installments, setInstallments] = useState(String(lease.installments));
  const [termMonths, setTermMonths] = useState("12");

  const fetchSuggestion = useServerFn(suggestRent);
  const suggest = useMutation({
    mutationFn: () =>
      fetchSuggestion({
        data: {
          unitType: lease.units?.unit_type ?? "",
          district: lease.units?.district ?? "",
          rooms: lease.units?.rooms ?? null,
          halls: lease.units?.halls ?? null,
          bathrooms: lease.units?.bathrooms ?? null,
          area: lease.units?.area ?? null,
          furnished: Boolean(lease.units?.furnished),
          floorNo: lease.units?.floor_no ?? null,
        },
      }),
    onSuccess: (res) => {
      if (res.suggestedRent) setRent(String(res.suggestedRent));
      if (res.source === "ai") toast.success(res.reasoning);
      else if (res.suggestedRent) toast.info(res.reasoning);
      else toast.warning(res.reasoning);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر جلب التسعير")),
  });

  const renew = useMutation({
    mutationFn: async () => {
      const annualRent = Number(rent || 0);
      const count = Number(installments || 1);
      const term = Number(termMonths);
      if (!Number.isFinite(annualRent) || annualRent <= 0)
        throw new Error("أدخل إيجارًا سنويًا صحيحًا");
      if (!Number.isInteger(count) || count < 1 || count > 24) {
        throw new Error("عدد الدفعات يجب أن يكون بين 1 و24");
      }
      if (count > term) {
        throw new Error("عدد الدفعات لا يجوز أن يتجاوز مدة العقد بالأشهر");
      }
      // العقد الجديد ودفعاته وإنهاء العقد القديم يتمّون معًا كعملية قاعدة بيانات ذرّية واحدة
      // (renew_lease، migration 20260924230000) — لا ثلاث كتابات منفصلة بتراجع يدوي كان ممكن
      // يترك عقدين ساريين بلا تراجع لو انقطع الاتصال بين الخطوات.
      const { error } = await supabase.rpc("renew_lease", {
        _source_lease_id: lease.id,
        _start_date: startDate,
        _annual_rent: annualRent,
        _installments: count,
        _term_months: term,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تجديد العقد وإنشاء دفعاته");
      onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر التجديد")),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">تجديد العقد</DialogTitle>
          <DialogDescription>
            {lease.units?.properties?.name} · وحدة {lease.units?.unit_number} —{" "}
            {lease.tenants?.full_name ?? "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>تاريخ بدء العقد الجديد</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>الإيجار السنوي (ريال)</Label>
            <Input inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => suggest.mutate()}
              disabled={suggest.isPending || !lease.units?.unit_type}
            >
              <Sparkles className="size-4 text-brass" />
              {suggest.isPending ? "جارٍ التسعير..." : "اقترح السعر حسب سوق الحي"}
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label>مدة العقد</Label>
            <Select value={termMonths} onValueChange={setTermMonths}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">شهر واحد</SelectItem>
                <SelectItem value="3">3 أشهر</SelectItem>
                <SelectItem value="6">6 أشهر</SelectItem>
                <SelectItem value="12">سنة كاملة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>عدد الدفعات</Label>
            <Input
              inputMode="numeric"
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {termMonths === "12"
              ? "سيُنشأ عقد سنة كاملة مع جدول دفعاته"
              : `سيُنشأ عقد ${termMonths} أشهر بإيجار يعادل حصته من الإيجار السنوي المُدخل`}
            ، ويُحوَّل العقد القديم إلى «منتهٍ»، ويصل إشعار للمالك والمستأجر.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={() => renew.mutate()} disabled={renew.isPending || !Number(rent)}>
            {renew.isPending ? "جارٍ التجديد..." : "تأكيد التجديد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type BulkRow = { startDate: string; rent: string; installments: string };

function BulkRenewDialog({
  leases,
  onClose,
  onDone,
}: {
  leases: RenewalLease[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Record<string, BulkRow>>(() =>
    Object.fromEntries(
      leases.map((l) => [
        l.id,
        {
          startDate: addDays(l.end_date, 1),
          rent: String(l.annual_rent),
          installments: String(l.installments),
        },
      ]),
    ),
  );
  const [results, setResults] = useState<Record<string, "ok" | "error"> | null>(null);

  const setRow = (id: string, patch: Partial<BulkRow>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));

  const bulkRenew = useMutation({
    mutationFn: async () => {
      // كل عقد يُجدَّد عبر renew_lease الذرّية نفسها المستخدمة بالتجديد المفرد — لا RPC جماعية
      // جديدة، فتسلسل استدعاءات مستقلة يعني فشل عقد واحد ما يوقف تجديد البقية.
      const outcome: Record<string, "ok" | "error"> = {};
      for (const lease of leases) {
        const row = rows[lease.id]!;
        const annualRent = Number(row.rent || 0);
        const count = Number(row.installments || 1);
        if (!Number.isFinite(annualRent) || annualRent <= 0 || !Number.isInteger(count)) {
          outcome[lease.id] = "error";
          continue;
        }
        // التجديد الجماعي دائمًا بعقد سنة كاملة — من يحتاج مدة أقصر لوحدة بعينها يستخدم "جدّد
        // العقد" المفرد بدل هذا الزر.
        const { error } = await supabase.rpc("renew_lease", {
          _source_lease_id: lease.id,
          _start_date: row.startDate,
          _annual_rent: annualRent,
          _installments: count,
          _term_months: 12,
        });
        outcome[lease.id] = error ? "error" : "ok";
      }
      return outcome;
    },
    onSuccess: (outcome) => {
      setResults(outcome);
      const okCount = Object.values(outcome).filter((v) => v === "ok").length;
      const errCount = leases.length - okCount;
      if (errCount === 0) toast.success(`تم تجديد ${okCount} عقد بنجاح`);
      else toast.warning(`تم تجديد ${okCount} من ${leases.length} — راجع العقود اللي فشلت`);
    },
  });

  const allDone = results && Object.keys(results).length === leases.length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">تجديد {leases.length} عقود دفعة واحدة</DialogTitle>
          <DialogDescription>
            راجع الإيجار وعدد الدفعات لكل عقد قبل التأكيد — كل عقد يُجدَّد بشكل مستقل.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto">
          {leases.map((l) => {
            const row = rows[l.id]!;
            const status = results?.[l.id];
            return (
              <div key={l.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {l.units?.properties?.name} · وحدة {l.units?.unit_number} —{" "}
                    {l.tenants?.full_name ?? "—"}
                  </p>
                  {status ? (
                    <Badge variant={status === "ok" ? "default" : "destructive"}>
                      {status === "ok" ? "تم التجديد" : "فشل"}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <Input
                    type="date"
                    value={row.startDate}
                    disabled={!!status}
                    onChange={(e) => setRow(l.id, { startDate: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    placeholder="الإيجار السنوي"
                    value={row.rent}
                    disabled={!!status}
                    onChange={(e) => setRow(l.id, { rent: e.target.value })}
                  />
                  <Input
                    inputMode="numeric"
                    placeholder="عدد الدفعات"
                    value={row.installments}
                    disabled={!!status}
                    onChange={(e) => setRow(l.id, { installments: e.target.value })}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={allDone ? onDone : onClose}>
            {allDone ? "إغلاق" : "إلغاء"}
          </Button>
          {!allDone ? (
            <Button onClick={() => bulkRenew.mutate()} disabled={bulkRenew.isPending}>
              {bulkRenew.isPending ? "جارٍ التجديد..." : `تأكيد تجديد ${leases.length} عقود`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const OWNER_DECISION_LABEL: Record<string, string> = {
  renew: "يوافق على التجديد بنفس الإيجار",
  renew_new_rent: "يوافق على التجديد بإيجار جديد",
  leave: "لا يرغب بالتجديد",
};

/** What owners decided about renewing leases on their units (from the owner dashboard). */
function OwnerDecisionsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["owner-renewal-decisions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owner_renewal_decisions")
        .select(
          "id, decision, proposed_rent, note, status, created_at, leases(end_date, annual_rent, units(unit_number, properties(name)))",
        )
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const handle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("owner_renewal_decisions")
        .update({ status: "handled", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("علّمنا قرار المالك كمعالج");
      queryClient.invalidateQueries({ queryKey: ["owner-renewal-decisions"] });
    },
    onError: () => toast.error("تعذّر التحديث"),
  });

  // Before the owner-features migration is applied the table does not exist: leave it out.
  if (isLoading || isError || !data) return null;
  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">قرارات الملاك في التجديد</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((d) => {
          const lease = d.leases;
          return (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {lease?.units?.properties?.name ?? "—"} · وحدة {lease?.units?.unit_number ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {OWNER_DECISION_LABEL[d.decision] ?? d.decision}
                  {d.decision === "renew_new_rent" && d.proposed_rent
                    ? ` · ${sar(d.proposed_rent)} بدل ${sar(lease?.annual_rent)}`
                    : ""}
                  {lease?.end_date ? ` · ينتهي ${shortDate(lease.end_date)}` : ""}
                  {d.note ? ` · ${d.note}` : ""} · {shortDate(d.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={d.decision === "leave" ? "destructive" : "default"}>
                  {d.decision === "leave" ? "عدم تجديد" : "تجديد"}
                </Badge>
                {d.status === "new" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={handle.isPending}
                    onClick={() => handle.mutate(d.id)}
                  >
                    تمت معالجته
                  </Button>
                ) : (
                  <Badge variant="outline">معالج</Badge>
                )}
              </div>
            </div>
          );
        })}
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">لم يحدّد أي مالك قراره بعد.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RenewalRequestsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["renewal-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewal_requests")
        .select(
          "id, decision, note, status, created_at, leases(units(unit_number, properties(name)), tenants(full_name))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const handle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("renewal_requests")
        .update({ status: "handled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("علّمنا الطلب كمعالج");
      queryClient.invalidateQueries({ queryKey: ["renewal-requests"] });
    },
    onError: () => toast.error("تعذّر التحديث"),
  });

  if (isLoading || !data) return null;
  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">طلبات التجديد من المستأجرين</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {r.leases?.tenants?.full_name ?? "—"} · وحدة {r.leases?.units?.unit_number ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {r.decision === "renew" ? "وافق على التجديد" : "يطلب المغادرة"}
                {r.note ? ` · ${r.note}` : ""} · {shortDate(r.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={r.decision === "renew" ? "default" : "destructive"}>
                {r.decision === "renew" ? "تجديد" : "مغادرة"}
              </Badge>
              {r.status === "new" ? (
                <Button size="sm" variant="outline" onClick={() => handle.mutate(r.id)}>
                  تمت معالجته
                </Button>
              ) : (
                <Badge variant="outline">معالج</Badge>
              )}
            </div>
          </div>
        ))}
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد طلبات من المستأجرين بعد.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

type DepositLease = {
  id: string;
  deposit: number;
  deposit_status: string;
  deposit_note: string | null;
  status: string;
  end_date: string;
  tenants: { full_name: string } | null;
  units: { unit_number: string; properties: { name: string } | null } | null;
};

function DepositsSection() {
  const queryClient = useQueryClient();
  const settle = useServerFn(settleDeposit);
  const [settling, setSettling] = useState<{
    lease: DepositLease;
    mode: "refunded" | "deducted";
  } | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["deposit-leases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leases")
        .select(
          "id, deposit, deposit_status, deposit_note, status, end_date, tenants(full_name), units(unit_number, properties(name))",
        )
        .gt("deposit", 0)
        .order("end_date");
      if (error) throw error;
      return data as DepositLease[];
    },
  });

  const settleMut = useMutation({
    mutationFn: (payload: {
      leaseId: string;
      status: "refunded" | "deducted";
      note?: string;
      deductedAmount?: number;
    }) => settle({ data: payload }),
    onSuccess: () => {
      setSettling(null);
      toast.success("سُوّيت الوديعة وأُبلغ المستأجر");
      queryClient.invalidateQueries({ queryKey: ["deposit-leases"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّرت التسوية")),
  });

  if (isLoading || !data || data.length === 0) return null;
  const statusLabel: Record<string, string> = {
    held: "محجوزة",
    refunded: "مستردة",
    deducted: "مخصومة",
  };
  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">ودائع التأمين</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((l) => (
          <div
            key={l.id}
            className="rounded-md border border-border bg-background px-4 py-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {l.tenants?.full_name ?? "—"} · وحدة {l.units?.unit_number ?? "—"} — وديعة{" "}
                {sar(l.deposit)}
              </p>
              <Badge variant={l.deposit_status === "held" ? "secondary" : "outline"}>
                {statusLabel[l.deposit_status] ?? l.deposit_status}
                {l.deposit_note ? ` · ${l.deposit_note}` : ""}
              </Badge>
            </div>
            {l.deposit_status !== "held" ? null : depositSettleable(l) ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={settleMut.isPending}
                  onClick={() => setSettling({ lease: l, mode: "refunded" })}
                >
                  استرداد كاملة
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={settleMut.isPending}
                  onClick={() => setSettling({ lease: l, mode: "deducted" })}
                >
                  خصم من الوديعة
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                تُسوّى الوديعة بعد انتهاء العقد في {shortDate(l.end_date)}
              </p>
            )}
          </div>
        ))}
      </CardContent>
      {settling ? (
        <SettleDepositDialog
          lease={settling.lease}
          mode={settling.mode}
          pending={settleMut.isPending}
          onClose={() => setSettling(null)}
          onConfirm={(payload) => settleMut.mutate({ leaseId: settling.lease.id, ...payload })}
        />
      ) : null}
    </Card>
  );
}

function SettleDepositDialog({
  lease,
  mode,
  pending,
  onClose,
  onConfirm,
}: {
  lease: DepositLease;
  mode: "refunded" | "deducted";
  pending: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    status: "refunded" | "deducted";
    note?: string;
    deductedAmount?: number;
  }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const deposit = Number(lease.deposit) || 0;
  const deducting = mode === "deducted";
  const parsed = parseAmount(amount);
  const amountError = !deducting
    ? null
    : parsed == null || parsed <= 0
      ? amount.trim()
        ? "أدخل مبلغًا صحيحًا"
        : null
      : parsed > deposit
        ? `مبلغ الخصم أكبر من الوديعة (${sar(deposit)})`
        : null;
  const valid = !deducting || (parsed != null && parsed > 0 && !amountError && !!note.trim());

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deducting ? "خصم من الوديعة" : "استرداد الوديعة كاملة"}</DialogTitle>
          <DialogDescription>
            {lease.tenants?.full_name ?? "—"} · {lease.units?.properties?.name ?? ""} وحدة{" "}
            {lease.units?.unit_number ?? "—"} — الوديعة {sar(deposit)}. سيُبلَّغ المستأجر بعد
            التأكيد، ولا يمكن التراجع.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {deducting ? (
            <div className="space-y-1">
              <Label htmlFor="deduct-amount">مبلغ الخصم</Label>
              <Input
                id="deduct-amount"
                dir="ltr"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!!amountError}
              />
              {amountError ? (
                <p className="text-xs text-destructive">{amountError}</p>
              ) : parsed != null && parsed > 0 ? (
                <p className="text-xs text-muted-foreground">
                  يُعاد للمستأجر {sar(deposit - parsed)}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="deposit-note">
              {deducting ? "سبب الخصم" : "ملاحظة التسوية (اختياري)"}
            </Label>
            <Input
              id="deposit-note"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={deducting ? "أضرار في المطبخ، فاتورة كهرباء متأخرة…" : ""}
              aria-describedby={deducting && !note.trim() ? "deposit-note-hint" : undefined}
            />
            {deducting && !note.trim() ? (
              <p id="deposit-note-hint" className="text-xs text-muted-foreground">
                اكتب سبب الخصم — يظهر للمستأجر في إشعار التسوية.
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onConfirm({
                status: mode,
                ...(note.trim() ? { note: note.trim() } : {}),
                ...(deducting && parsed ? { deductedAmount: parsed } : {}),
              })
            }
          >
            {pending ? "جارٍ التسوية…" : deducting ? "تأكيد الخصم" : "تأكيد الاسترداد"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
