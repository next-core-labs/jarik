import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Download, Paperclip, Phone, Star } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { OfficeIdentity } from "@/components/office-identity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  sar,
  shortDate,
  paymentStatusLabel,
  maintenanceStatusLabel,
  leaseStatusLabel,
  priorityText,
  unitStatusLabel,
} from "@/lib/format";
import { effectiveStatus, toDatetimeLocalValue } from "@/lib/dates";
import { roleLabel, useMyRoles, type AppRole } from "@/lib/use-role";
import { downloadElementAsPdf } from "@/lib/pdf";
import { useOrgBranding } from "@/lib/use-org-branding";
import {
  submitTransferNotice,
  rateMaintenance,
  decideMaintenanceApproval,
} from "@/lib/portal-actions.functions";
import { QuickMaintenance } from "@/components/quick-maintenance";
import { RenewalDecision } from "@/components/renewal-decision";

export const Route = createFileRoute("/_authenticated/portal")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "صفحتي — جارك" },
      {
        name: "description",
        content: "بوابة المالك والمستأجر والفني: العقود والمدفوعات والفواتير وطلبات الصيانة.",
      },
      { property: "og:title", content: "صفحتي — جارك" },
      { property: "og:description", content: "كل ما يخصّك: عقدك، مدفوعاتك، صيانتك." },
    ],
  }),
  component: Portal,
});

type JobContact = { request_id: string; tenant_name: string | null; tenant_phone: string | null };

/** A visit time as the technician entered it (viewer's local time, like the datetime-local field). */
function visitTime(iso: string) {
  return new Date(iso).toLocaleString("ar-SA-u-ca-gregory", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Portal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const roles = me?.roles ?? [];
  const isTechnician = roles.includes("technician");
  const isOwner = roles.includes("owner");
  const isTenant = roles.includes("tenant");
  // A technician-only account has no leases, payments, invoices or units of its own: skip those
  // queries and cards and show just the assigned jobs.
  const technicianOnly = isTechnician && !isOwner && !isTenant;

  // A single-role owner or tenant gets a dashboard built around that one role instead of this
  // combined page; anyone with more than one role (or a technician) keeps the combined view,
  // since a dedicated dashboard could only show part of what they need.
  useEffect(() => {
    if (!me) return;
    if (isOwner && !isTenant && !isTechnician) {
      navigate({ to: "/owner-dashboard", replace: true });
    } else if (isTenant && !isOwner && !isTechnician) {
      navigate({ to: "/tenant-dashboard", replace: true });
    }
  }, [me, isOwner, isTenant, isTechnician, navigate]);

  const { org: orgQuery, logoDataUrl } = useOrgBranding();
  const statementRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const downloadStatement = async () => {
    if (!statementRef.current) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf(statementRef.current, "كشف-حساب-المالك.pdf");
      toast.success("نزل كشف الحساب PDF");
    } catch (e) {
      console.error("Owner statement PDF failed", e);
      toast.error("تعذّر إنشاء الملف");
    } finally {
      setDownloading(false);
    }
  };

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [ratingNotes, setRatingNotes] = useState<Record<string, string>>({});
  const receiptRef = useRef<HTMLDivElement>(null);
  const [receipt, setReceipt] = useState<{
    id: string;
    amount: number;
    due_date: string;
    paid_date: string | null;
    unit: string;
    property: string;
  } | null>(null);

  const notifyTransfer = useMutation({
    mutationFn: async (payload: { paymentId: string; reference: string }) =>
      submitTransferNotice({ data: payload }),
    onSuccess: () => {
      toast.success("أبلغنا المكتب بالتحويل — سيُراجع ويُسجّل السداد");
      queryClient.invalidateQueries({ queryKey: ["portal"] });
    },
    onError: () => toast.error("تعذّر إرسال الإبلاغ"),
  });

  const rate = useMutation({
    mutationFn: async (payload: { requestId: string; rating: number; note?: string }) =>
      rateMaintenance({ data: payload }),
    onSuccess: () => {
      toast.success("شكرًا — وصل تقييمك للمكتب");
      queryClient.invalidateQueries({ queryKey: ["portal"] });
    },
    onError: () => toast.error("تعذّر إرسال التقييم"),
  });

  const decide = useMutation({
    mutationFn: async (payload: { requestId: string; approved: boolean }) =>
      decideMaintenanceApproval({ data: payload }),
    onSuccess: () => {
      toast.success("سُجّل قرارك ووصل للمكتب");
      queryClient.invalidateQueries({ queryKey: ["portal"] });
    },
    onError: () => toast.error("تعذّر تسجيل القرار"),
  });

  const downloadReceipt = async (p: {
    id: string;
    amount: number;
    due_date: string;
    paid_date: string | null;
    unit: string;
    property: string;
  }) => {
    // Mount the hidden receipt node synchronously so it's in the DOM before the capture starts.
    flushSync(() => setReceipt(p));
    if (!receiptRef.current) return;
    try {
      await downloadElementAsPdf(receiptRef.current, `إيصال-${p.due_date}.pdf`);
      toast.success("نزل الإيصال PDF");
    } catch (e) {
      console.error("Receipt PDF failed", e);
      toast.error("تعذّر إنشاء الإيصال");
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["portal", me?.userId ?? null, technicianOnly],
    enabled: !!me,
    queryFn: async () => {
      const skip = { data: null } as const;
      const [tenant, leases, payments, invoices, maintenance, properties] = await Promise.all([
        technicianOnly
          ? skip
          : supabase.from("tenants").select("id, full_name, phone").maybeSingle(),
        technicianOnly
          ? skip
          : supabase
              .from("leases")
              .select(
                "id, start_date, end_date, annual_rent, installments, ejar_contract_no, ejar_status, status, units(id, unit_number, properties(name))",
              )
              .order("end_date", { ascending: false }),
        technicianOnly
          ? skip
          : supabase
              .from("payments")
              .select(
                "id, amount, due_date, paid_date, status, transfer_reference, method, leases(units(unit_number, properties(name)))",
              )
              .order("due_date"),
        technicianOnly
          ? skip
          : supabase
              .from("invoices")
              .select("id, invoice_number, issue_date, total, zatca_status")
              .order("issue_date", { ascending: false }),
        supabase
          .from("maintenance_requests")
          .select(
            "id, title, description, priority, status, cost, created_at, approval_status, rating, technician_id, unit_id, scheduled_at, photo_path, audio_path, units(unit_number, owner_id, properties(name))",
          )
          .order("created_at", { ascending: false }),
        technicianOnly
          ? skip
          : supabase
              .from("properties")
              .select("id, name, city, owner_id, units(id, status, annual_rent)")
              .order("created_at"),
      ]);
      const [units, events, market] = await Promise.all([
        technicianOnly
          ? skip
          : supabase
              .from("units")
              .select(
                "id, unit_number, unit_type, status, annual_rent, owner_id, properties(name, city, owner_id)",
              )
              .order("unit_number"),
        technicianOnly
          ? skip
          : supabase
              .from("unit_events")
              .select("id, title, body, kind, created_at, units(unit_number, properties(name))")
              .order("created_at", { ascending: false })
              .limit(40),
        technicianOnly ? skip : supabase.rpc("market_stats"),
      ]);
      const roi = technicianOnly ? skip : await supabase.rpc("owner_property_roi");
      // Tenant name + phone for the technician's open jobs (the tenants table itself stays
      // closed to technicians). If the call fails, the card simply shows no contact row.
      let contacts: JobContact[] = [];
      if (isTechnician) {
        try {
          const res = await supabase.rpc("technician_job_contacts");
          if (!res.error) contacts = res.data ?? [];
        } catch {
          // No contact row on the card; the rest of the job still renders.
        }
      }
      // Technicians and tenants can read the units/properties they work in or rent; the owner
      // views below (وحداتي، عقاراتي، the statement PDF) count only what this account owns.
      const userId = me?.userId ?? null;
      const ownedUnits = (units.data ?? []).filter(
        (u) => (u.owner_id ?? u.properties?.owner_id) === userId,
      );
      const ownedProperties = (properties.data ?? []).filter((p) => p.owner_id === userId);
      return {
        tenant: tenant.data,
        leases: leases.data ?? [],
        payments: payments.data ?? [],
        invoices: invoices.data ?? [],
        maintenance: maintenance.data ?? [],
        properties: ownedProperties,
        units: ownedUnits,
        events: events.data ?? [],
        market: market.data ?? [],
        roi: roi.data ?? [],
        contacts,
      };
    },
  });

  const createRequest = useMutation({
    mutationFn: async () => {
      const unitId = data?.leases[0]?.units?.id ?? null;
      const { error } = await supabase.from("maintenance_requests").insert({
        title,
        description: description || null,
        tenant_id: data?.tenant?.id ?? null,
        unit_id: unitId,
        source: "app",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إرسال طلب الصيانة");
      setTitle("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["portal"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: () => toast.error("تعذّر إرسال الطلب"),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("maintenance_requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث حالة العمل");
      queryClient.invalidateQueries({ queryKey: ["portal"] });
    },
    onError: () => toast.error("تعذّر التحديث"),
  });

  // The DB lets the assigned technician change only status and scheduled_at
  // (guard_maintenance_columns), so the visit time is the one field they edit here.
  const schedule = useMutation({
    mutationFn: async ({ id, at }: { id: string; at: string }) => {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ scheduled_at: at ? new Date(at).toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { at }) => {
      toast.success(at ? "حُفظ موعد الزيارة" : "أُلغي موعد الزيارة");
      queryClient.invalidateQueries({ queryKey: ["portal"] });
    },
    onError: () => toast.error("تعذّر حفظ الموعد"),
  });

  const openMedia = async (path: string) => {
    const { data: url } = await supabase.storage
      .from("maintenance-media")
      .createSignedUrl(path, 300);
    if (url?.signedUrl) window.open(url.signedUrl, "_blank", "noopener");
    else toast.error("تعذّر فتح المرفق");
  };

  if (isLoading || !data || !me) {
    return (
      <>
        <PageHeader title="صفحتي" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const dueTotal = data.payments
    .filter((p) => p.status !== "paid")
    .reduce((s, p) => s + Number(p.amount), 0);
  const allUnits = data.properties.flatMap((p) => p.units ?? []);
  // A sold unit has left the owner's rental pool and must not dilute their occupancy rate.
  const rentableUnits = allUnits.filter((u) => u.status !== "sold");
  const occupied = rentableUnits.filter((u) => u.status === "occupied").length;
  // Only the jobs assigned to this account — an owner who is also a technician can read their
  // units' requests too, and those aren't "my jobs".
  const myJobs = data.maintenance.filter((m) => m.technician_id === me.userId);

  return (
    <>
      <PageHeader
        title="صفحتي"
        subtitle="كل ما يخصّك في مكان واحد — والنظام يلاحق المهام والاستحقاقات نيابةً عنك."
        action={
          isOwner && data.units.length > 0 ? (
            <Button variant="outline" disabled={downloading} onClick={downloadStatement}>
              <Download className="size-4" />
              {downloading ? "جارٍ إنشاء الملف…" : "كشف حسابي PDF"}
            </Button>
          ) : undefined
        }
      />

      <OfficeIdentity />

      {roles.includes("tenant") ? (
        <>
          <RenewalDecision />
          <QuickMaintenance />
        </>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {roles.length === 0 ? (
          <Badge variant="outline">بدون دور — راجع مدير النظام</Badge>
        ) : (
          roles.map((r) => <Badge key={r}>{roleLabel[r as AppRole] ?? r}</Badge>)
        )}
      </div>

      {isTechnician ? (
        <Card className="mb-6 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">أعمال الصيانة المسندة لي</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {myJobs.map((m) => {
              const where = [
                m.units?.properties?.name,
                m.units?.unit_number ? `وحدة ${m.units.unit_number}` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              const contact = data.contacts.find((c) => c.request_id === m.id);
              const tenantPhone = contact?.tenant_phone?.trim() || null;
              return (
                <div key={m.id} className="rounded-md border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{m.title}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{priorityText(m.priority)}</Badge>
                      <Badge variant="outline">
                        {maintenanceStatusLabel[m.status] ?? m.status}
                      </Badge>
                    </div>
                  </div>
                  {m.description ? (
                    <p className="mt-2 text-sm text-muted-foreground">{m.description}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {where ? `${where} · ` : ""}طُلب {shortDate(m.created_at)}
                  </p>
                  {contact?.tenant_name ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      المستأجر: {contact.tenant_name}
                    </p>
                  ) : null}

                  {m.status !== "done" && m.status !== "cancelled" ? (
                    <div className="mt-3 max-w-xs space-y-1">
                      <label htmlFor={`visit-${m.id}`} className="text-xs text-muted-foreground">
                        موعد الزيارة
                      </label>
                      <input
                        id={`visit-${m.id}`}
                        // Uncontrolled: re-mount when the saved time changes so the field shows
                        // the server value.
                        key={`${m.id}-${m.scheduled_at ?? ""}`}
                        type="datetime-local"
                        dir="ltr"
                        disabled={schedule.isPending}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        defaultValue={toDatetimeLocalValue(m.scheduled_at)}
                        onBlur={(e) => {
                          const v = e.target.value;
                          if (v !== toDatetimeLocalValue(m.scheduled_at)) {
                            schedule.mutate({ id: m.id, at: v });
                          }
                        }}
                      />
                    </div>
                  ) : m.scheduled_at ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      موعد الزيارة: {visitTime(m.scheduled_at)}
                    </p>
                  ) : null}

                  {tenantPhone || m.photo_path || m.audio_path ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {tenantPhone ? (
                        <Button size="sm" variant="outline" asChild>
                          <a href={`tel:${tenantPhone.replace(/[^\d+]/g, "")}`}>
                            <Phone className="size-4" />
                            اتصال بالمستأجر
                          </a>
                        </Button>
                      ) : null}
                      {m.photo_path ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openMedia(m.photo_path!)}
                        >
                          <Paperclip className="size-4" />
                          صورة الطلب
                        </Button>
                      ) : null}
                      {m.audio_path ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openMedia(m.audio_path!)}
                        >
                          <Paperclip className="size-4" />
                          الوصف الصوتي
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {m.status !== "done" && m.status !== "cancelled" ? (
                    <div className="mt-3 flex gap-2">
                      {m.status === "new" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ id: m.id, status: "in_progress" })}
                        >
                          بدء العمل
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `تأكيد إنجاز "${m.title}"؟ سيُغلق الطلب ولا يمكنك التراجع من هنا.`,
                            )
                          ) {
                            setStatus.mutate({ id: m.id, status: "done" });
                          }
                        }}
                      >
                        {setStatus.isPending ? "جارٍ الحفظ…" : "إنجاز"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {myJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد أعمال مسندة لك حاليًا.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isOwner ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">عقاراتي</CardTitle>
            </CardHeader>
            <CardContent className="font-display text-2xl font-bold">
              {data.properties.length}
            </CardContent>
          </Card>
          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">نسبة الإشغال</CardTitle>
            </CardHeader>
            <CardContent className="font-display text-2xl font-bold">
              {rentableUnits.length ? Math.round((occupied / rentableUnits.length) * 100) : 0}%
            </CardContent>
          </Card>
          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">مستحقات غير محصّلة</CardTitle>
            </CardHeader>
            <CardContent className="font-display text-2xl font-bold">{sar(dueTotal)}</CardContent>
          </Card>
        </div>
      ) : null}

      {isOwner && data.market.length > 0 ? (
        <Card className="mb-6 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">تقرير سوق الأحياء</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.market.map(
              (m: {
                district: string | null;
                units_count: number;
                avg_rent: number;
                occupancy_pct: number;
              }) => (
                <div
                  key={m.district ?? "—"}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
                >
                  <p className="font-medium">{m.district ?? "بدون حي محدد"}</p>
                  <p className="text-muted-foreground">
                    متوسط الإيجار السنوي{" "}
                    <span className="font-bold text-foreground">{sar(m.avg_rent)}</span>
                    {" · "}الإشغال{" "}
                    <span className="font-bold text-foreground">
                      {Math.round(m.occupancy_pct)}%
                    </span>
                    {" · "}
                    {m.units_count} وحدة
                  </p>
                </div>
              ),
            )}
            <p className="text-xs text-muted-foreground">
              أرقام مجمعة من الوحدات المسجلة في المنصة — تساعدك تسعّر وحدتك بسعر عادل للسوق.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isOwner && data.roi.length > 0 ? (
        <Card className="mb-6 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">مقارنة عائد عقاراتي</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(
              data.roi as {
                property_id: string;
                property_name: string;
                units_count: number;
                collected: number;
                expenses: number;
                net: number;
                roi_pct: number;
              }[]
            ).map((r) => (
              <div
                key={r.property_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
              >
                <p className="font-medium">
                  {r.property_name} · {r.units_count} وحدة
                </p>
                <p className="text-muted-foreground">
                  محصّل <span className="font-bold text-foreground">{sar(r.collected)}</span>
                  {" · "}مصروفات{" "}
                  <span className="font-bold text-foreground">{sar(r.expenses)}</span>
                  {" · "}الصافي <span className="font-bold text-foreground">{sar(r.net)}</span>
                  {" · "}العائد{" "}
                  <span className="font-bold text-foreground">{Number(r.roi_pct)}%</span>
                </p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              العائد = الصافي مقسومًا على إجمالي الإيجار السنوي للعقار.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isOwner && data.maintenance.some((m) => m.approval_status === "pending") ? (
        <Card className="mb-6 border-brass/50 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">صيانة تنتظر موافقتك</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.maintenance
              .filter((m) => m.approval_status === "pending")
              .map((m) => (
                <div key={m.id} className="rounded-md border border-border bg-background p-4">
                  <p className="font-medium">{m.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {m.units?.properties?.name ?? ""} · وحدة {m.units?.unit_number ?? "—"} · التكلفة{" "}
                    <span className="font-bold text-foreground">{sar(m.cost)}</span>
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ requestId: m.id, approved: true })}
                    >
                      موافقة
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ requestId: m.id, approved: false })}
                    >
                      رفض
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {data.units.length > 0 ? (
        <Card className="mb-6 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">وحداتي</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.units.map((u) => (
              <div key={u.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    وحدة {u.unit_number} · {u.unit_type}
                  </p>
                  {/* "default" (red) is reserved for the vacant/available mark — occupied and sold
                      units are neither the price, the primary action, nor "available". */}
                  <Badge
                    variant={
                      u.status === "vacant"
                        ? "default"
                        : u.status === "sold"
                          ? "outline"
                          : "secondary"
                    }
                  >
                    {unitStatusLabel[u.status] ?? u.status}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {u.properties?.name} {u.properties?.city ? `· ${u.properties.city}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{sar(u.annual_rent)} سنويًا</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {technicianOnly ? null : (
        <Card className="mb-6 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">تحديثات الوحدات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.events.map((e) => (
              <div key={e.id} className="rounded-md border border-border bg-background px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{e.title}</p>
                  <span className="text-xs text-muted-foreground">{shortDate(e.created_at)}</span>
                </div>
                {e.body ? <p className="mt-1 text-sm text-muted-foreground">{e.body}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {e.units?.properties?.name ?? ""} · وحدة {e.units?.unit_number ?? "—"}
                </p>
              </div>
            ))}
            {data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                لا توجد تحديثات بعد — أي دفعة أو تغيير على وحدتك يظهر هنا تلقائيًا.
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {technicianOnly ? null : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-base">عقودي</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.leases.map((l) => (
                <div key={l.id} className="rounded-md border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {l.units?.properties?.name} · وحدة {l.units?.unit_number}
                    </p>
                    <Badge variant="outline">{leaseStatusLabel[l.status] ?? l.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {shortDate(l.start_date)} — {shortDate(l.end_date)} · {sar(l.annual_rent)}{" "}
                    سنويًا · {l.installments} دفعات
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    إيجار: {l.ejar_contract_no ?? "غير مسجّل"} (
                    {l.ejar_status === "synced" ? "مسجّل" : "بانتظار التسجيل"})
                  </p>
                </div>
              ))}
              {data.leases.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد عقود مرتبطة بحسابك.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-base">مدفوعاتي</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.payments.map((p) => (
                <div
                  key={p.id}
                  className="rounded-md border border-border bg-background px-4 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{shortDate(p.due_date)}</span>
                    <span className="font-medium">{sar(p.amount)}</span>
                    <Badge
                      variant={
                        p.status === "paid"
                          ? "default"
                          : effectiveStatus(p) === "overdue"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {paymentStatusLabel[effectiveStatus(p)] ?? p.status}
                    </Badge>
                  </div>
                  {p.status === "paid" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() =>
                        downloadReceipt({
                          id: p.id,
                          amount: Number(p.amount),
                          due_date: p.due_date,
                          paid_date: p.paid_date,
                          unit: p.leases?.units?.unit_number ?? "—",
                          property: p.leases?.units?.properties?.name ?? "",
                        })
                      }
                    >
                      <Download className="size-4" />
                      إيصال PDF
                    </Button>
                  ) : p.transfer_reference ? (
                    <p className="mt-2 text-xs text-brass">
                      أبلغت عن تحويل: {p.transfer_reference} — بانتظار تأكيد المكتب.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        className="h-9 max-w-52"
                        placeholder="رقم مرجع التحويل"
                        value={refs[p.id] ?? ""}
                        onChange={(e) => setRefs((v) => ({ ...v, [p.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        disabled={(refs[p.id] ?? "").trim().length < 3 || notifyTransfer.isPending}
                        onClick={() =>
                          notifyTransfer.mutate({
                            paymentId: p.id,
                            reference: (refs[p.id] ?? "").trim(),
                          })
                        }
                      >
                        سدّدت — أبلغ المكتب
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {data.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد دفعات.</p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="shadow-deed">
            <CardHeader>
              <CardTitle className="text-base">فواتيري</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm"
                >
                  <span dir="ltr">{inv.invoice_number}</span>
                  <span>{shortDate(inv.issue_date)}</span>
                  <span className="font-medium">{sar(inv.total)}</span>
                </div>
              ))}
              {data.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد فواتير.</p>
              ) : null}
            </CardContent>
          </Card>

          {!isTechnician ? (
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="text-base">طلب صيانة</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  placeholder="عنوان الطلب — مثال: تسريب في المطبخ"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Textarea
                  placeholder="وصف المشكلة"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <Button
                  disabled={!title.trim() || createRequest.isPending}
                  onClick={() => createRequest.mutate()}
                >
                  إرسال الطلب
                </Button>

                <div className="space-y-2 pt-2">
                  {data.maintenance.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-md border border-border bg-background px-4 py-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{m.title}</span>
                        <Badge variant="outline">
                          {maintenanceStatusLabel[m.status] ?? m.status}
                        </Badge>
                      </div>
                      {m.status === "done" ? (
                        m.rating ? (
                          <p className="mt-2 text-xs text-brass">تقييمك: {"★".repeat(m.rating)}</p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            <Input
                              className="h-9"
                              placeholder="ملاحظتك على الصيانة (اختياري)"
                              value={ratingNotes[m.id] ?? ""}
                              onChange={(e) =>
                                setRatingNotes((v) => ({ ...v, [m.id]: e.target.value }))
                              }
                            />
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Button
                                  key={n}
                                  size="icon"
                                  variant="outline"
                                  className="size-8"
                                  disabled={rate.isPending}
                                  title={`${n} من 5`}
                                  onClick={() =>
                                    rate.mutate(
                                      ratingNotes[m.id]
                                        ? { requestId: m.id, rating: n, note: ratingNotes[m.id]! }
                                        : { requestId: m.id, rating: n },
                                    )
                                  }
                                >
                                  <Star className="size-3.5" />
                                </Button>
                              ))}
                            </div>
                          </div>
                        )
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {receipt ? (
        <div
          ref={receiptRef}
          dir="rtl"
          className="pointer-events-none fixed -left-[10000px] top-0 w-[700px] bg-white p-8 text-black"
          aria-hidden="true"
        >
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-3">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="" className="size-12 rounded object-contain" />
              ) : null}
              <p className="text-lg font-bold">{orgQuery.data?.company_name ?? "المكتب العقاري"}</p>
            </div>
            <p className="text-sm text-gray-500">إيصال سداد</p>
          </div>
          <table className="mt-6 w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2 text-gray-600">المستأجر</td>
                <td className="py-2 text-left font-bold">{data.tenant?.full_name ?? "—"}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">العقار والوحدة</td>
                <td className="py-2 text-left font-bold">
                  {receipt.property} · وحدة {receipt.unit}
                </td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">تاريخ الاستحقاق</td>
                <td className="py-2 text-left font-bold">{shortDate(receipt.due_date)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">تاريخ السداد</td>
                <td className="py-2 text-left font-bold">
                  {receipt.paid_date ? shortDate(receipt.paid_date) : "—"}
                </td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-gray-600">المبلغ</td>
                <td className="py-2 text-left font-bold">{sar(receipt.amount)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-6 text-xs text-gray-500">
            إيصال صادر من منصة جارك — رقم الدفعة {receipt.id}
          </p>
        </div>
      ) : null}

      {isOwner ? (
        <div
          ref={statementRef}
          dir="rtl"
          className="pointer-events-none fixed -left-[10000px] top-0 w-[700px] bg-white p-8 text-black"
          aria-hidden="true"
        >
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-3">
              {logoDataUrl ? (
                <img src={logoDataUrl} alt="" className="size-12 rounded object-contain" />
              ) : null}
              <div>
                <p className="text-lg font-bold">
                  {orgQuery.data?.company_name ?? "المكتب العقاري"}
                </p>
                {orgQuery.data?.fal_license_no ? (
                  <p className="text-xs text-gray-500">ترخيص فال: {orgQuery.data.fal_license_no}</p>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-gray-500">
              تاريخ الإصدار: {new Date().toLocaleDateString("ar-SA")}
            </p>
          </div>
          <h2 className="mt-6 text-xl font-bold">كشف حساب المالك</h2>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-right text-gray-600">
                <th className="py-2">الوحدة</th>
                <th className="py-2">النوع</th>
                <th className="py-2">العقار</th>
                <th className="py-2">الحالة</th>
                <th className="py-2">الإيجار السنوي</th>
              </tr>
            </thead>
            <tbody>
              {data.units.map((u) => (
                <tr key={u.id} className="border-b">
                  <td className="py-2">{u.unit_number}</td>
                  <td className="py-2">{u.unit_type}</td>
                  <td className="py-2">{u.properties?.name ?? "—"}</td>
                  <td className="py-2">{unitStatusLabel[u.status] ?? u.status}</td>
                  <td className="py-2">{sar(u.annual_rent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-between border-t pt-3 text-sm font-bold">
            <span>إجمالي الإيجارات السنوية</span>
            <span>{sar(data.units.reduce((s, u) => s + Number(u.annual_rent), 0))}</span>
          </div>
          <p className="mt-2 text-sm">المستحقات غير المحصّلة: {sar(dueTotal)}</p>
          <p className="mt-6 text-xs text-gray-400">صادر تلقائيًا من منصة إدارة الأملاك</p>
        </div>
      ) : null}
    </>
  );
}
