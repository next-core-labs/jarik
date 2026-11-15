import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { userErrorMessage } from "@/lib/auth-errors";
import { shortDate } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  new: "جديد",
  scheduled: "مجدول",
  done: "تم التصوير",
  cancelled: "ملغى",
};

function when(iso: string) {
  return new Date(iso).toLocaleString("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * «طلبات التصوير» in /hq → «المكاتب والسوق»: units offices asked Jarak's team to photograph.
 * Open requests first; schedule a visit, mark it done, or cancel — the office is notified each time.
 */
export function HqPhotoRequests() {
  const queryClient = useQueryClient();
  const [showClosed, setShowClosed] = useState(false);

  const requests = useQuery({
    queryKey: ["hq-photo-requests"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("hq_photo_requests");
      if (error) throw error;
      return data ?? [];
    },
  });

  const setStatus = useMutation({
    mutationFn: async (input: {
      id: string;
      status: "scheduled" | "done" | "cancelled";
      at?: string;
      note?: string;
    }) => {
      const { error } = await supabase.rpc("hq_set_photo_request", {
        _id: input.id,
        _status: input.status,
        ...(input.at ? { _scheduled_for: new Date(input.at).toISOString() } : {}),
        ...(input.note?.trim() ? { _note: input.note.trim() } : {}),
      });
      if (error) throw error;
      return input.status;
    },
    onSuccess: (status) => {
      toast.success(
        status === "scheduled"
          ? "حُدّد الموعد وأُبلغ المكتب"
          : status === "done"
            ? "سُجّل التصوير وأُبلغ المكتب"
            : "أُلغي الطلب وأُبلغ المكتب",
      );
      queryClient.invalidateQueries({ queryKey: ["hq-photo-requests"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الطلب")),
  });

  const all = requests.data ?? [];
  const open = all.filter((r) => r.status === "new" || r.status === "scheduled");
  const rows = showClosed ? all : open;

  return (
    <Card className="shadow-deed">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="size-4 text-brass" aria-hidden />
          طلبات التصوير ({open.length} مفتوح)
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "المفتوحة فقط" : "عرض كل الطلبات"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {requests.isLoading ? (
          <Skeleton className="h-32" />
        ) : requests.error ? (
          <p className="text-sm text-destructive">تعذّر تحميل طلبات التصوير.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showClosed ? "لا توجد طلبات تصوير." : "لا توجد طلبات تصوير مفتوحة."}
          </p>
        ) : (
          rows.map((r) => (
            <PhotoRequestRow
              key={r.id}
              row={r}
              busy={setStatus.isPending}
              onSet={(status, at, note) =>
                setStatus.mutate({
                  id: r.id,
                  status,
                  ...(at ? { at } : {}),
                  ...(note ? { note } : {}),
                })
              }
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function PhotoRequestRow({
  row: r,
  busy,
  onSet,
}: {
  row: {
    id: string;
    status: string;
    notes: string | null;
    hq_note: string | null;
    scheduled_for: string | null;
    created_at: string;
    unit_label: string;
    district: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    office_name: string | null;
    office_phone: string | null;
    requested_by_name: string | null;
    requested_by_phone: string | null;
  };
  busy: boolean;
  onSet: (status: "scheduled" | "done" | "cancelled", at?: string, note?: string) => void;
}) {
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const isOpen = r.status === "new" || r.status === "scheduled";
  const phone = r.requested_by_phone || r.office_phone;
  return (
    <div className="space-y-2 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{r.unit_label}</p>
          <p className="text-xs text-muted-foreground">
            {[r.district, r.city].filter(Boolean).join(" · ")} · مكتب «{r.office_name ?? "—"}» ·{" "}
            {shortDate(r.created_at)}
          </p>
        </div>
        <Badge variant={isOpen ? "default" : "secondary"}>
          {STATUS_LABEL[r.status] ?? r.status}
        </Badge>
      </div>
      {r.notes ? <p className="text-muted-foreground">ملاحظة المكتب: {r.notes}</p> : null}
      {r.scheduled_for ? <p>الموعد: {when(r.scheduled_for)}</p> : null}
      {r.hq_note ? <p className="text-muted-foreground">ملاحظة جارك: {r.hq_note}</p> : null}
      <div className="flex flex-wrap gap-3 text-xs">
        {phone ? (
          <a href={`tel:${phone}`} className="flex items-center gap-1 underline underline-offset-4">
            <Phone className="size-3.5" aria-hidden />
            <span dir="ltr">{phone}</span>
            {r.requested_by_name ? ` (${r.requested_by_name})` : ""}
          </a>
        ) : null}
        {r.lat != null && r.lng != null ? (
          <a
            href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 underline underline-offset-4"
          >
            <MapPin className="size-3.5" aria-hidden />
            الموقع على الخريطة
          </a>
        ) : null}
      </div>
      {isOpen ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
          <Input
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="w-56"
            aria-label="موعد التصوير"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة للمكتب (اختياري)"
            className="min-w-[12rem] flex-1"
            maxLength={500}
          />
          <Button size="sm" disabled={busy || !at} onClick={() => onSet("scheduled", at, note)}>
            تحديد الموعد
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onSet("done", undefined, note)}
          >
            تم التصوير
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={() => onSet("cancelled", undefined, note)}
          >
            إلغاء
          </Button>
        </div>
      ) : null}
    </div>
  );
}
