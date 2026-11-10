import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { userErrorMessage } from "@/lib/auth-errors";
import { priorityText } from "@/lib/format";

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
const NONE = "none";

/**
 * «طلب صيانة جديد» from the office itself — a vacant unit before letting, a call from a tenant
 * without the app, a building inspection. Until now only a tenant could open a request, so the
 * office's maintenance board stayed empty with nothing to act on. The database fills the office
 * (a_fill_org) and starts the owner-approval state from the cost (guard_maintenance_columns).
 */
export function NewMaintenanceDialog({
  open,
  onOpenChange,
  technicians,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicians: { id: string; name: string }[];
}) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [technicianId, setTechnicianId] = useState(NONE);
  const [scheduledAt, setScheduledAt] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnitId("");
    setTitle("");
    setDescription("");
    setPriority("medium");
    setTechnicianId(NONE);
    setScheduledAt("");
    setTried(false);
  }, [open]);

  // The office's units (RLS shows only them), with the tenant of the active lease if there is one,
  // so the request also appears on that tenant's dashboard.
  const units = useQuery({
    queryKey: ["maintenance-new-units"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id, unit_number, unit_name, status, properties(name), leases(status, tenant_id)")
        .order("unit_number");
      if (error) throw error;
      return (data ?? [])
        .map((u) => ({
          id: u.id,
          label: `${u.properties?.name ?? "—"} · ${u.unit_name || `وحدة ${u.unit_number}`}`,
          tenantId: u.leases?.find((l) => l.status === "active")?.tenant_id ?? null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "ar"));
    },
  });

  const errors = {
    unit: unitId ? null : "اختر الوحدة",
    title: title.trim().length >= 3 ? null : "اكتب وصفًا قصيرًا للعطل (3 أحرف على الأقل)",
    scheduledAt:
      scheduledAt && new Date(scheduledAt).getTime() < Date.now() - 60_000
        ? "موعد الزيارة في الماضي"
        : null,
  };
  const valid = Object.values(errors).every((e) => e === null);
  const show = (key: keyof typeof errors) => (tried ? errors[key] : null);

  const create = useMutation({
    mutationFn: async () => {
      if (!valid) throw new Error(Object.values(errors).find(Boolean) ?? "أكمل بيانات الطلب");
      const unit = units.data?.find((u) => u.id === unitId);
      const technician = technicianId === NONE ? null : technicianId;
      const { data, error } = await supabase
        .from("maintenance_requests")
        .insert({
          unit_id: unitId,
          tenant_id: unit?.tenantId ?? null,
          title: title.trim(),
          description: description.trim() || null,
          priority,
          technician_id: technician,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          source: "office",
        })
        .select("id")
        .single();
      if (error) throw error;
      if (technician) {
        // Best effort, like the board's own assignment: the request stands even if this fails.
        await supabase.from("notifications").insert({
          user_id: technician,
          title: "أُسند إليك عمل صيانة",
          body: title.trim(),
          kind: "maintenance",
          source: "system",
          related_table: "maintenance_requests",
          related_id: data.id,
        });
      }
    },
    onSuccess: () => {
      toast.success("أُضيف طلب الصيانة");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إضافة طلب الصيانة")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">طلب صيانة جديد</DialogTitle>
          <DialogDescription>
            يُضاف إلى «جديد» في لوحة الصيانة، ويظهر لمستأجر الوحدة إن كان عليها عقد ساري.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            // Missing fields are named under each field; only a real failure gets a toast.
            if (valid) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-unit`}>الوحدة</Label>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger id={`${uid}-unit`} aria-invalid={Boolean(show("unit"))}>
                <SelectValue placeholder={units.isLoading ? "جارٍ التحميل…" : "اختر الوحدة"} />
              </SelectTrigger>
              <SelectContent>
                {(units.data ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {units.data && units.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                لا توجد وحدات بعد — أضفها من{" "}
                <Link to="/properties" className="underline underline-offset-4">
                  الأملاك والوحدات
                </Link>
                .
              </p>
            ) : null}
            {show("unit") ? <p className="text-xs text-destructive">{show("unit")}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-title`}>العطل</Label>
            <Input
              id={`${uid}-title`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: تسريب مياه في المطبخ"
              maxLength={120}
              aria-invalid={Boolean(show("title"))}
            />
            {show("title") ? <p className="text-xs text-destructive">{show("title")}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-desc`}>التفاصيل (اختياري)</Label>
            <Textarea
              id={`${uid}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-priority`}>الأولوية</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id={`${uid}-priority`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {priorityText(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-tech`}>الفني (اختياري)</Label>
              <Select value={technicianId} onValueChange={setTechnicianId}>
                <SelectTrigger id={`${uid}-tech`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون إسناد الآن</SelectItem>
                  {technicians.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {technicians.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  لا يوجد فنيون في مكتبك — ادعُهم من{" "}
                  <Link to="/office-team" className="underline underline-offset-4">
                    فريق المكتب
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-at`}>موعد الزيارة (اختياري)</Label>
            <Input
              id={`${uid}-at`}
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              aria-invalid={Boolean(show("scheduledAt"))}
            />
            {show("scheduledAt") ? (
              <p className="text-xs text-destructive">{show("scheduledAt")}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "جارٍ الإضافة…" : "إضافة الطلب"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
