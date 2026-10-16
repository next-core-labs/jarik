import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Paperclip, Zap } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { smartScheduleMaintenance } from "@/lib/office-tools.functions";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toDatetimeLocalValue } from "@/lib/dates";
import { sar, shortDate, maintenanceStatusLabel, priorityText } from "@/lib/format";
import { useOrgBranding } from "@/lib/use-org-branding";

const approvalLabel: Record<string, string> = {
  not_required: "لا تحتاج موافقة",
  pending: "بانتظار موافقة المالك",
  approved: "وافق المالك",
  rejected: "رفض المالك",
};

export const Route = createFileRoute("/_authenticated/maintenance")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "الصيانة — جارك" },
      { name: "description", content: "طلبات الصيانة وإسنادها للفنيين وتحديث حالتها وتكلفتها." },
      { property: "og:title", content: "الصيانة — جارك" },
      { property: "og:description", content: "متابعة طلبات الصيانة حتى الإنجاز." },
    ],
  }),
  component: Maintenance,
});

const columns = [
  { key: "new", title: "جديد" },
  { key: "in_progress", title: "جاري" },
  { key: "done", title: "منجز" },
] as const;

const priorities = ["urgent", "high", "medium", "low"] as const;

function Maintenance() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const { org } = useOrgBranding();
  const threshold = Number(org.data?.owner_approval_threshold ?? 2000);

  const { data, isLoading } = useQuery({
    queryKey: ["maintenance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_requests")
        .select(
          "id, unit_id, title, description, priority, status, cost, source, created_at, scheduled_at, technician_id, approval_status, approval_note, rating, rating_note, photo_path, audio_path, tenants(full_name), units(unit_number, owner_id, properties(name, owner_id))",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // سقف الصيانة الفعّال لكل وحدة على حدة — سقف اتفاقية الإدارة السارية عليها إن وُجد (قد يختلف
  // عن حد المكتب الافتراضي)، وإلا owner_approval_threshold. دالة جماعية واحدة بدل RPC منفصلة لكل
  // صف. my_org_id() هنا هو مكتب المتصل الفعلي — قد يدير وحدة مكتب آخر عبر اتفاقية، والسقف حينها
  // يُحسب من منظور مكتبه هو تحديدًا (effective_maintenance_cap(unit_id, org_id)).
  const unitIds = useMemo(
    () =>
      Array.from(new Set((data ?? []).map((m) => m.unit_id).filter((id): id is string => !!id))),
    [data],
  );
  const caps = useQuery({
    queryKey: ["maintenance-caps", org.data?.id, unitIds],
    enabled: !!org.data?.id && unitIds.length > 0,
    queryFn: async () => {
      // The caps function may not exist yet in the database; treat that as "no caps".
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: { unit_id: string; cap: number }[] | null; error: unknown }>;
      const { data, error } = await rpc("effective_maintenance_caps", {
        _unit_ids: unitIds,
        _org_id: org.data!.id,
      });
      const map = new Map<string, number>();
      if (error) return map;
      for (const row of data ?? []) map.set(row.unit_id, Number(row.cap));
      return map;
    },
  });
  const capFor = (unitId: string | null) =>
    (unitId ? caps.data?.get(unitId) : undefined) ?? threshold;

  // The office's own technicians — the only people the database lets a job be assigned to.
  const technicians = useQuery({
    queryKey: ["office-technicians"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("office_people");
      if (error) throw error;
      return (data ?? [])
        .filter((p) => p.relation === "member" && p.roles.includes("technician"))
        .map((p) => ({ id: p.user_id, name: p.full_name || p.email }));
    },
  });
  const technicianName = (id: string | null) =>
    id ? (technicians.data?.find((t) => t.id === id)?.name ?? "فني") : null;

  const assign = useMutation({
    mutationFn: async ({
      id,
      technicianId,
      title,
    }: {
      id: string;
      technicianId: string | null;
      title: string;
    }) => {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ technician_id: technicianId })
        .eq("id", id);
      if (error) throw error;
      if (technicianId) {
        // Best effort, like the smart schedule: the assignment stands even if the notice fails.
        await supabase.from("notifications").insert({
          user_id: technicianId,
          title: "أُسند إليك عمل صيانة",
          body: title,
          kind: "maintenance",
          source: "system",
          related_table: "maintenance_requests",
          related_id: id,
        });
      }
      return technicianId;
    },
    onSuccess: (technicianId) => {
      toast.success(
        technicianId ? `أُسند الطلب إلى ${technicianName(technicianId)}` : "أُلغي إسناد الطلب",
      );
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إسناد الطلب")),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("maintenance_requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث حالة الطلب");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) =>
      toast.error(userErrorMessage(e, "تعذّر التحديث — الصلاحية للموظف أو الفني المسند")),
  });

  const saveCost = useMutation({
    mutationFn: async ({
      id,
      cost,
      hasOwner,
      cap,
    }: {
      id: string;
      cost: number;
      hasOwner: boolean;
      cap: number;
    }) => {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({
          cost,
          approval_status: cost > cap && hasOwner ? "pending" : "not_required",
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("حُفظت التكلفة — إن تجاوزت الحد فستُرسل للمالك للموافقة");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حفظ التكلفة")),
  });

  const schedule = useMutation({
    mutationFn: async ({ id, at }: { id: string; at: string }) => {
      const { error } = await supabase
        .from("maintenance_requests")
        .update({ scheduled_at: at ? new Date(at).toISOString() : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("حُدد موعد الزيارة");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حفظ الموعد")),
  });

  const smart = useServerFn(smartScheduleMaintenance);
  const scheduleSmart = useMutation({
    mutationFn: (id: string) => smart({ data: { requestId: id } }),
    onSuccess: (res) => {
      toast.success(`أسندنا الطلب إلى ${res.technician} وحدّدنا موعدًا يناسب الأولوية`);
      // Without this the visit-time field stayed empty, and a later blur then saved "" over
      // the smart appointment.
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّرت الجدولة الذكية")),
  });

  const openMedia = async (path: string) => {
    const { data: url } = await supabase.storage
      .from("maintenance-media")
      .createSignedUrl(path, 300);
    if (url?.signedUrl) window.open(url.signedUrl, "_blank");
    else toast.error("تعذّر فتح المرفق");
  };

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="الصيانة" />
        <Skeleton className="h-64" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="الصيانة"
        subtitle="طلب المستأجر يصبح مهمة، والحالة تتحدّث حتى الإنجاز وترحيل التكلفة."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">الحالة</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">الأولوية</Label>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأولويات</SelectItem>
              {priorities.map((p) => (
                <SelectItem key={p} value={p}>
                  {priorityText(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className={`grid gap-4 ${statusFilter === "all" ? "lg:grid-cols-3" : ""}`}>
        {columns
          .filter((col) => statusFilter === "all" || col.key === statusFilter)
          .map((col) => {
            const items = data.filter(
              (m) =>
                m.status === col.key &&
                (priorityFilter === "all" ||
                  // Compared by label so legacy spellings (normal, emergency…) match their level.
                  priorityText(m.priority) === priorityText(priorityFilter)),
            );
            return (
              <Card key={col.key} className="shadow-deed">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-base">{col.title}</CardTitle>
                  <Badge variant="outline">{items.length}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {items.map((m) => (
                    <div key={m.id} className="rounded-md border border-border bg-background p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{m.title}</p>
                        <Badge
                          variant={
                            m.priority === "urgent" || m.priority === "high"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {priorityText(m.priority)}
                        </Badge>
                      </div>
                      {m.description ? (
                        <p className="mt-2 text-sm text-muted-foreground">{m.description}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {m.units?.properties?.name} · وحدة {m.units?.unit_number} ·{" "}
                        {m.tenants?.full_name ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {shortDate(m.created_at)}
                        {Number(m.cost) > 0 ? ` · التكلفة ${sar(m.cost)}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        الفني: {technicianName(m.technician_id) ?? "غير مسند"}
                      </p>
                      {m.approval_status && m.approval_status !== "not_required" ? (
                        <Badge
                          className="mt-2"
                          variant={
                            m.approval_status === "approved"
                              ? "default"
                              : m.approval_status === "rejected"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {approvalLabel[m.approval_status] ?? m.approval_status}
                        </Badge>
                      ) : null}
                      {m.rating ? (
                        <p className="mt-2 text-xs text-brass">
                          تقييم المستأجر: {"★".repeat(m.rating)}
                          {m.rating_note ? ` — ${m.rating_note}` : ""}
                        </p>
                      ) : null}
                      {m.status !== "done" ? (
                        <div className="mt-3 space-y-1">
                          <label className="text-xs text-muted-foreground">الفني المسند</label>
                          <Select
                            value={m.technician_id ?? "none"}
                            disabled={assign.isPending}
                            onValueChange={(v) =>
                              assign.mutate({
                                id: m.id,
                                technicianId: v === "none" ? null : v,
                                title: m.title,
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="اختر الفني" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">بدون فني</SelectItem>
                              {(technicians.data ?? []).map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                              {/* Still show a technician who has since left the team list. */}
                              {m.technician_id &&
                              !(technicians.data ?? []).some((t) => t.id === m.technician_id) ? (
                                <SelectItem value={m.technician_id}>فني</SelectItem>
                              ) : null}
                            </SelectContent>
                          </Select>
                          {technicians.data && technicians.data.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              لا يوجد فنيون بعد — أضف فنيًا من «فريق المكتب».
                            </p>
                          ) : null}
                          <label className="text-xs text-muted-foreground">
                            التكلفة المقدّرة (تحتاج موافقة المالك فوق {sar(capFor(m.unit_id))})
                          </label>
                          <input
                            // Uncontrolled: re-mount when the saved cost changes (e.g. a refetch after
                            // a colleague's edit) so the field shows the server value, not a stale one.
                            key={`${m.id}-${m.cost ?? ""}`}
                            type="number"
                            dir="ltr"
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                            defaultValue={Number(m.cost) || ""}
                            onBlur={(e) => {
                              const v = Number(e.target.value || 0);
                              if (v !== Number(m.cost)) {
                                saveCost.mutate({
                                  id: m.id,
                                  cost: v,
                                  // Same rule as private.unit_owner(): the unit's own owner, else
                                  // the property's — most units are owned via their property.
                                  hasOwner: !!(m.units?.owner_id ?? m.units?.properties?.owner_id),
                                  cap: capFor(m.unit_id),
                                });
                              }
                            }}
                          />
                          <label className="text-xs text-muted-foreground">موعد الزيارة</label>
                          <input
                            // Uncontrolled: re-mount when the saved time changes (e.g. after the
                            // smart schedule) so the field shows the server value.
                            key={`${m.id}-${m.scheduled_at ?? ""}`}
                            type="datetime-local"
                            dir="ltr"
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                            defaultValue={toDatetimeLocalValue(m.scheduled_at)}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v !== toDatetimeLocalValue(m.scheduled_at)) {
                                schedule.mutate({ id: m.id, at: v });
                              }
                            }}
                          />
                        </div>
                      ) : null}
                      {m.photo_path || m.audio_path ? (
                        <div className="mt-3 flex flex-wrap gap-2">
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
                      {m.status !== "done" ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {m.status === "new" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setStatus.mutate({ id: m.id, status: "in_progress" })}
                            >
                              بدء العمل
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={scheduleSmart.isPending}
                            onClick={() => scheduleSmart.mutate(m.id)}
                          >
                            <Zap className="size-4" />
                            جدولة ذكية
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setStatus.mutate({ id: m.id, status: "done" })}
                          >
                            إنجاز
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-success">
                          {maintenanceStatusLabel[m.status]}
                        </p>
                      )}
                    </div>
                  ))}
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">لا توجد طلبات.</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
      </div>
    </>
  );
}
