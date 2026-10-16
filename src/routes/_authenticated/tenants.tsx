import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FilePlus2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { exportWorkbook } from "@/lib/export-excel";
import { inviteTenant } from "@/lib/tenant-portal.functions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app-shell";
import { LeaseDetailsDialog, NewLeaseDialog } from "@/components/lease-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { sar, shortDate, leaseStatusLabel } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tenants")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "المستأجرون والعقود — جارك" },
      {
        name: "description",
        content: "بيانات المستأجرين والعقود وجدول الدفعات وحالة التوثيق في إيجار.",
      },
      { property: "og:title", content: "المستأجرون والعقود — جارك" },
      { property: "og:description", content: "العقود والدفعات وحالة التوافق مع إيجار." },
    ],
  }),
  component: Tenants,
});

function Tenants() {
  const queryClient = useQueryClient();
  const [invitingLease, setInvitingLease] = useState<{
    id: string;
    tenantName: string;
    tenantEmail: string | null;
  } | null>(null);
  const [openLeaseId, setOpenLeaseId] = useState<string | null>(null);
  const [newLease, setNewLease] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["leases"],
    queryFn: async () => {
      const [leases, tenants] = await Promise.all([
        supabase
          .from("leases")
          .select(
            "id, start_date, end_date, annual_rent, term_months, installments, deposit, ejar_contract_no, ejar_status, status, tenants(full_name, phone, email, user_id), units(unit_number, properties(name))",
          )
          .order("start_date", { ascending: false }),
        supabase.from("tenants").select("id, full_name, phone, national_id, email"),
      ]);
      if (leases.error) throw leases.error;
      const tenantRows = tenants.data ?? [];
      const ratings = new Map<string, number>();
      await Promise.all(
        tenantRows.map(async (t) => {
          const { data: count } = await supabase.rpc("tenant_overdue_count", {
            _tenant_id: t.id,
          });
          ratings.set(t.id, Number(count ?? 0));
        }),
      );
      return { leases: leases.data ?? [], tenants: tenantRows, ratings };
    },
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="المستأجرون والعقود" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const exportTenants = () => {
    if (!data) return;
    exportWorkbook("المستأجرون-والعقود.xlsx", [
      {
        name: "العقود",
        rows: data.leases.map((l) => ({
          المستأجر: l.tenants?.full_name ?? "",
          العقار: l.units?.properties?.name ?? "",
          الوحدة: l.units?.unit_number ?? "",
          من: l.start_date ?? "",
          إلى: l.end_date ?? "",
          الإيجار_السنوي: Number(l.annual_rent),
          عدد_الدفعات: l.installments ?? "",
          الوديعة: Number(l.deposit ?? 0),
          رقم_إيجار: l.ejar_contract_no ?? "",
          الحالة: leaseStatusLabel[l.status] ?? l.status,
        })),
      },
      {
        name: "المستأجرون",
        rows: data.tenants.map((t) => ({
          الاسم: t.full_name ?? "",
          الجوال: t.phone ?? "",
          رقم_الهوية: t.national_id ?? "",
          البريد: t.email ?? "",
        })),
      },
    ]);
    toast.success("نزل ملف الإكسل — جاهز للمحاسب");
  };

  type Lease = NonNullable<typeof data>["leases"][number];
  // "default" (red) is reserved for price/primary action/available — an "إيجار" sync status is
  // none of those.
  const ejarBadge = (l: Lease) => (
    <Badge variant={l.ejar_status === "synced" ? "secondary" : "outline"}>
      {l.ejar_status === "synced" ? (l.ejar_contract_no ?? "موثّق") : "بانتظار"}
    </Badge>
  );
  // An active lease means the unit is occupied — same "not available" reasoning as the
  // unit-status badges: this is not the vacant/available mark either.
  const leaseBadge = (l: Lease) => (
    <Badge variant={l.status === "active" ? "secondary" : "outline"}>
      {leaseStatusLabel[l.status] ?? l.status}
    </Badge>
  );
  const tenantAccount = (l: Lease, full: boolean) =>
    l.tenants?.user_id ? (
      <Badge variant="outline" className="self-start">
        مرتبط بحساب
      </Badge>
    ) : (
      <Button
        size="sm"
        variant="outline"
        className={full ? "w-full" : undefined}
        onClick={(e) => {
          // The row itself opens the lease details.
          e.stopPropagation();
          setInvitingLease({
            id: l.id,
            tenantName: l.tenants?.full_name ?? "المستأجر",
            tenantEmail: l.tenants?.email ?? null,
          });
        }}
      >
        <UserPlus className="size-4" />
        دعوة مستأجر
      </Button>
    );
  const termBadge = (l: Lease) =>
    l.term_months && l.term_months !== 12 ? (
      <Badge variant="outline" className="ms-2">
        عقد {l.term_months} أشهر
      </Badge>
    ) : null;

  return (
    <>
      <PageHeader
        title="المستأجرون والعقود"
        subtitle="العقود السارية، جدول الدفعات، ورقم عقد «إيجار» وحالة توثيقه."
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setNewLease(true)}>
              <FilePlus2 className="size-4" />
              عقد جديد
            </Button>
            <Button variant="outline" onClick={exportTenants}>
              <Download className="size-4" />
              تصدير Excel
            </Button>
          </div>
        }
      />

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">العقود</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Phones: one card per contract — eight columns don't fit a 390px screen. */}
          <ul className="divide-y divide-border md:hidden">
            {data.leases.map((l) => (
              <li key={l.id} className="flex flex-col gap-2 py-4 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{l.tenants?.full_name ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">
                      {l.units?.properties?.name} · {l.units?.unit_number}
                    </p>
                  </div>
                  {leaseBadge(l)}
                </div>
                <p className="text-sm text-muted-foreground">
                  {shortDate(l.start_date)} — {shortDate(l.end_date)}
                  {termBadge(l)}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold tabular-nums">
                    {sar(l.annual_rent)} · {l.installments} دفعات
                  </span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    إيجار {ejarBadge(l)}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOpenLeaseId(l.id)}>
                    تفاصيل العقد
                  </Button>
                  {tenantAccount(l, true)}
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المستأجر</TableHead>
                  <TableHead>الوحدة</TableHead>
                  <TableHead>المدة</TableHead>
                  <TableHead>الإيجار السنوي</TableHead>
                  <TableHead>الدفعات</TableHead>
                  <TableHead>إيجار</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>حساب المستأجر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.leases.map((l) => (
                  <TableRow
                    key={l.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    aria-label={`تفاصيل عقد ${l.tenants?.full_name ?? ""}`}
                    onClick={() => setOpenLeaseId(l.id)}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        setOpenLeaseId(l.id);
                      }
                    }}
                  >
                    <TableCell className="font-medium">{l.tenants?.full_name ?? "—"}</TableCell>
                    <TableCell>
                      {l.units?.properties?.name} · {l.units?.unit_number}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {shortDate(l.start_date)} — {shortDate(l.end_date)}
                      {termBadge(l)}
                    </TableCell>
                    <TableCell>{sar(l.annual_rent)}</TableCell>
                    <TableCell>{l.installments} دفعات</TableCell>
                    <TableCell>{ejarBadge(l)}</TableCell>
                    <TableCell>{leaseBadge(l)}</TableCell>
                    <TableCell>{tenantAccount(l, false)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.leases.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              لا توجد عقود بعد — أنشئ أول عقد من «عقد جديد».
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">المستأجرون</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.tenants.map((t) => {
            const overdue = data.ratings.get(t.id) ?? 0;
            return (
              <div key={t.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{t.full_name}</p>
                  {/* "default" (red) is reserved for price/primary action/available — a tenant's
                      payment standing is none of those. */}
                  <Badge
                    variant={overdue === 0 ? "outline" : overdue <= 2 ? "secondary" : "destructive"}
                  >
                    {overdue === 0
                      ? "منتظم"
                      : overdue <= 2
                        ? `متأخر ${overdue}`
                        : `متعثر ${overdue}`}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
                  {t.phone ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {t.national_id ?? ""}
                </p>
                {overdue > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {overdue} {overdue === 1 ? "دفعة متأخرة" : "دفعات متأخرة"} غير مسددة
                  </p>
                ) : null}
              </div>
            );
          })}
          {data.tenants.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد بيانات.</p>
          ) : null}
        </CardContent>
      </Card>

      {openLeaseId ? (
        <LeaseDetailsDialog leaseId={openLeaseId} onClose={() => setOpenLeaseId(null)} />
      ) : null}
      <NewLeaseDialog open={newLease} onOpenChange={setNewLease} />

      {invitingLease ? (
        <InviteTenantDialog
          lease={invitingLease}
          onClose={() => setInvitingLease(null)}
          onDone={() => {
            setInvitingLease(null);
            queryClient.invalidateQueries({ queryKey: ["leases"] });
          }}
        />
      ) : null}
    </>
  );
}

function InviteTenantDialog({
  lease,
  onClose,
  onDone,
}: {
  lease: { id: string; tenantName: string; tenantEmail: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(lease.tenantEmail ?? "");
  const invite = useServerFn(inviteTenant);

  const send = useMutation({
    mutationFn: () => invite({ data: { leaseId: lease.id, email: email.trim() } }),
    onSuccess: () => {
      toast.success("أُرسلت دعوة الدخول إلى بريد المستأجر");
      onDone();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الدعوة")),
  });

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">دعوة مستأجر للدخول</DialogTitle>
          <DialogDescription>{lease.tenantName}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">بريد المستأجر الإلكتروني</Label>
            <Input
              id="invite-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tenant@example.com"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            يصله بريد دخول من Supabase يفتح له حساب مستأجر مربوط بهذا العقد. إذا كان له حساب من قبل
            بنفس البريد، يكفي يدخل من صفحة دخول المستأجر ثم يزور رابط تفعيل حسابه.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending || !validEmail}>
            {send.isPending ? "جارٍ الإرسال..." : "إرسال الدعوة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
