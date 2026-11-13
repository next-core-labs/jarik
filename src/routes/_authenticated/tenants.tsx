import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, FilePlus2, MessageCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { exportWorkbook } from "@/lib/export-excel";
import { inviteTenant, type TenantInviteResult } from "@/lib/tenant-portal.functions";
import { whatsappHref } from "@/lib/market";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app-shell";
import { EndLeaseDialog, LeaseDetailsDialog, NewLeaseDialog } from "@/components/lease-dialog";
import { leaseStatusText } from "@/components/lease-schedule";
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
import { arCount, arNum, daysUntil, monthsLabel, sar, shortDate } from "@/lib/format";

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
    tenantPhone: string | null;
  } | null>(null);
  const [openLeaseId, setOpenLeaseId] = useState<string | null>(null);
  const [newLease, setNewLease] = useState(false);
  const [endingLease, setEndingLease] = useState<{
    id: string;
    start_date: string;
    end_date: string;
    label: string;
  } | null>(null);

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
          الحالة: leaseStatusText(l.status),
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
      {leaseStatusText(l.status)}
    </Badge>
  );
  // An active lease past its end date waits for a decision: renew it or record the move-out.
  const endAction = (l: Lease, full: boolean) =>
    l.status === "active" ? (
      <Button
        size="sm"
        variant={daysUntil(l.end_date) < 0 ? "destructive" : "outline"}
        className={full ? "w-full" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setEndingLease({
            id: l.id,
            start_date: l.start_date,
            end_date: l.end_date,
            label: `${l.units?.properties?.name ?? ""} · وحدة ${l.units?.unit_number ?? "—"}`,
          });
        }}
      >
        إنهاء العقد
      </Button>
    ) : null;
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
            tenantPhone: l.tenants?.phone ?? null,
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
        عقد {monthsLabel(l.term_months)}
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
                    {sar(l.annual_rent)} · {installmentsLabel(l.installments)}
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
                  {endAction(l, true)}
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
                  <TableHead />
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
                    <TableCell>{installmentsLabel(l.installments)}</TableCell>
                    <TableCell>{ejarBadge(l)}</TableCell>
                    <TableCell>{leaseBadge(l)}</TableCell>
                    <TableCell>{tenantAccount(l, false)}</TableCell>
                    <TableCell>{endAction(l, false)}</TableCell>
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
                        ? `متأخر ${arNum(overdue)}`
                        : `متعثر ${arNum(overdue)}`}
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
                    {arCount(overdue, {
                      one: "دفعة متأخرة غير مسددة",
                      two: "دفعتان متأخرتان غير مسددتين",
                      few: "دفعات متأخرة غير مسددة",
                      many: "دفعة متأخرة غير مسددة",
                    })}
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
      {endingLease ? (
        <EndLeaseDialog
          lease={endingLease}
          onClose={() => setEndingLease(null)}
          onDone={() => setEndingLease(null)}
        />
      ) : null}

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
  lease: { id: string; tenantName: string; tenantEmail: string | null; tenantPhone: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(lease.tenantEmail ?? "");
  const [result, setResult] = useState<TenantInviteResult | null>(null);
  const invite = useServerFn(inviteTenant);

  const send = useMutation({
    mutationFn: () => invite({ data: { leaseId: lease.id, email: email.trim() } }),
    onSuccess: (res) => setResult(res),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إنشاء الدعوة")),
  });

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/tenant/login`;
  // What goes to the tenant: the one-time activation link, or (existing account) where to sign in.
  const message = result
    ? result.link
      ? `مرحبًا ${lease.tenantName}، دعاك مكتبك العقاري إلى جارك لمتابعة عقدك ودفعاتك وطلبات الصيانة. فعّل حسابك من هذا الرابط (لمرة واحدة):\n${result.link}`
      : `مرحبًا ${lease.tenantName}، أُضيف عقدك إلى حسابك على جارك. ادخل ببريدك ${email.trim()} من هنا:\n${loginUrl}`
    : "";
  const whatsapp = result ? whatsappHref(lease.tenantPhone, message) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(result?.link ?? message);
      toast.success("نُسخ");
    } catch {
      toast.error("تعذّر النسخ — انسخه يدويًا");
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && (result ? onDone() : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">دعوة مستأجر للدخول</DialogTitle>
          <DialogDescription>{lease.tenantName}</DialogDescription>
        </DialogHeader>

        {!result ? (
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
                aria-invalid={Boolean(email.trim()) && !validEmail}
              />
              {email.trim() && !validEmail ? (
                <p className="text-xs text-destructive">
                  البريد الإلكتروني غير صحيح — مثال: name@example.com
                </p>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              نجهّز له رابط تفعيل تُرسله بالواتساب أو تنسخه، ويصله بالبريد أيضًا متى كان البريد
              مفعّلًا. إن كان له حساب على جارك بنفس البريد تظهر له الدعوة في حسابه ليقبلها.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2">
              {result.existingAccount
                ? "لهذا البريد حساب على جارك — تظهر له الدعوة في حسابه فيقبلها، ثم يُربط العقد به."
                : "جهزت الدعوة — أرسل رابط التفعيل للمستأجر."}{" "}
              {result.emailed
                ? "وأُرسلت له رسالة بالبريد أيضًا."
                : "البريد غير مفعّل حاليًا، فأرسلها له بنفسك."}
            </p>
            {result.link ? (
              <Input readOnly dir="ltr" value={result.link} onFocus={(e) => e.target.select()} />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {whatsapp ? (
                <Button asChild>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-4" />
                    إرسال بالواتساب
                  </a>
                </Button>
              ) : null}
              <Button variant="outline" onClick={copy}>
                <Copy className="size-4" />
                {result.link ? "نسخ الرابط" : "نسخ الرسالة"}
              </Button>
            </div>
            {!lease.tenantPhone ? (
              <p className="text-xs text-muted-foreground">
                لا يوجد رقم جوال للمستأجر — أضفه في بياناته لتظهر أداة الواتساب.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button variant="outline" onClick={onDone}>
              تم
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                إلغاء
              </Button>
              <Button onClick={() => send.mutate()} disabled={send.isPending || !validEmail}>
                {send.isPending ? "جارٍ التجهيز..." : "إنشاء الدعوة"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** «٤ دفعات»، «دفعتان»، «١٢ دفعة». */
function installmentsLabel(n: number) {
  return arCount(n, { one: "دفعة واحدة", two: "دفعتان", few: "دفعات", many: "دفعة" });
}
