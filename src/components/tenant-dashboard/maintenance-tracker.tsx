import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { rateMaintenance } from "@/lib/portal-actions.functions";
import { shortDate, maintenanceStatusLabel, priorityText } from "@/lib/format";

const STAGES = [
  { key: "received", label: "استُلم" },
  { key: "assigned", label: "تم تعيين فني" },
  { key: "on_way", label: "في الطريق" },
  { key: "done", label: "تم" },
] as const;

type MaintenanceRequest = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  technician_id: string | null;
  scheduled_at: string | null;
  rating: number | null;
  rating_note: string | null;
  created_at: string;
};

/** How far the 4-stage tracker got, synthesized from status + technician_id (no dedicated DB column). */
function reachedStage(m: MaintenanceRequest): number {
  if (m.status === "done") return 4;
  if (m.status === "in_progress") return 3;
  if (m.technician_id) return 2;
  return 1;
}

function StageTracker({ request }: { request: MaintenanceRequest }) {
  const reached = reachedStage(request);
  return (
    <div className="mt-3">
      <div className="flex items-center">
        {STAGES.map((stage, i) => (
          <div key={stage.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={`size-3 rounded-full ${
                  i + 1 <= reached ? "bg-brass" : "border border-border bg-muted"
                }`}
              />
              <span className="w-14 text-center text-[10px] text-muted-foreground">
                {stage.label}
              </span>
            </div>
            {i < STAGES.length - 1 ? (
              <span className={`mx-1 h-0.5 flex-1 ${i + 1 < reached ? "bg-brass" : "bg-muted"}`} />
            ) : null}
          </div>
        ))}
      </div>
      {request.scheduled_at ? (
        <p className="mt-2 text-xs text-muted-foreground">
          موعد الزيارة:{" "}
          {new Date(request.scheduled_at).toLocaleString("ar-SA-u-ca-gregory", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      ) : null}
    </div>
  );
}

function RatingPicker({ requestId, unitId }: { requestId: string; unitId: string }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [note, setNote] = useState("");

  // Through the server function, not a direct UPDATE: it checks the request is the caller's own,
  // done and not yet rated, and notifies the office of the rating.
  const rate = useServerFn(rateMaintenance);
  const submitRating = useMutation({
    mutationFn: () =>
      rate({
        data: note.trim()
          ? { requestId, rating: selected, note: note.trim() }
          : { requestId, rating: selected },
      }),
    onSuccess: () => {
      toast.success("تم إرسال تقييمك");
      queryClient.invalidateQueries({ queryKey: ["tenant-maintenance-tracker", unitId] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال التقييم")),
  });

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} من 5`}
            className="text-brass"
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => setSelected(n)}
          >
            <Star className={`size-5 ${n <= (hovered || selected) ? "fill-brass" : ""}`} />
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        placeholder="ملاحظتك على الخدمة (اختياري)"
        maxLength={400}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        size="sm"
        disabled={selected < 1 || submitRating.isPending}
        onClick={() => submitRating.mutate()}
      >
        {submitRating.isPending ? "جارٍ الإرسال…" : "إرسال التقييم"}
      </Button>
    </div>
  );
}

/** قائمة طلبات صيانة المستأجر لوحدته: المفتوحة بمتتبّع المراحل، والمنجزة بزر تقييم. */
export function MaintenanceTracker({ unitId }: { unitId: string }) {
  const [ratingOpenFor, setRatingOpenFor] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-maintenance-tracker", unitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("maintenance_requests")
        .select(
          "id, title, description, status, priority, technician_id, scheduled_at, rating, rating_note, created_at",
        )
        .eq("unit_id", unitId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading || !data) return <Skeleton className="h-40" />;

  const open = data.filter((m) => m.status !== "done" && m.status !== "cancelled");
  const done = data.filter((m) => m.status === "done");

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">طلبات الصيانة</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">الطلبات المفتوحة</h3>
          <div className="space-y-3">
            {open.map((m) => (
              <div key={m.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{m.title}</p>
                  <Badge
                    variant={
                      m.priority === "urgent" || m.priority === "high" ? "destructive" : "secondary"
                    }
                  >
                    {priorityText(m.priority)}
                  </Badge>
                </div>
                {m.description ? (
                  <p className="mt-2 text-sm text-muted-foreground">{m.description}</p>
                ) : null}
                <StageTracker request={m} />
                <p className="mt-2 text-xs text-muted-foreground">{shortDate(m.created_at)}</p>
              </div>
            ))}
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد طلبات صيانة مفتوحة.</p>
            ) : null}
          </div>
        </div>

        {done.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">منجزة</h3>
            <div className="space-y-3">
              {done.map((m) => (
                <div key={m.id} className="rounded-md border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{m.title}</p>
                    <Badge variant="outline">{maintenanceStatusLabel[m.status] ?? m.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{shortDate(m.created_at)}</p>
                  {m.rating ? (
                    <p className="mt-2 text-xs text-brass">
                      تقييم: {"★".repeat(m.rating)}
                      {m.rating_note ? ` — ${m.rating_note}` : ""}
                    </p>
                  ) : ratingOpenFor[m.id] ? (
                    <RatingPicker requestId={m.id} unitId={unitId} />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setRatingOpenFor((v) => ({ ...v, [m.id]: true }))}
                    >
                      قيّم الخدمة
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
