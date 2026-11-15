import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { userErrorMessage } from "@/lib/auth-errors";

export type OpenPhotoRequest = { status: "new" | "scheduled"; scheduled_for: string | null };

/** Date and time of a booked shoot, in Riyadh time. */
function shootTime(iso: string) {
  return new Date(iso).toLocaleString("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * «طلب تصوير» on a unit card: the office asks Jarak's team to photograph the unit
 * (request_unit_photos). While a request is open the card shows where it stands instead.
 */
export function UnitPhotoRequest({
  unitId,
  unitLabel,
  open: openRequest,
}: {
  unitId: string;
  unitLabel: string;
  open: OpenPhotoRequest | null;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState(false);
  const [notes, setNotes] = useState("");

  const request = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("request_unit_photos", {
        _unit_id: unitId,
        ...(notes.trim() ? { _notes: notes.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("وصل طلب التصوير لإدارة جارك — سنبلغك بالموعد");
      setDialog(false);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["unit-photo-requests"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال طلب التصوير")),
  });

  if (openRequest) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Camera className="size-3.5 text-brass" aria-hidden />
        {openRequest.status === "scheduled" && openRequest.scheduled_for
          ? `موعد التصوير: ${shootTime(openRequest.scheduled_for)}`
          : "طلب التصوير وصل لإدارة جارك — بانتظار الموعد"}
      </p>
    );
  }

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setDialog(true)}>
        <Camera className="size-4" />
        طلب تصوير
      </Button>
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">طلب تصوير الوحدة</DialogTitle>
            <DialogDescription>
              {unitLabel} — يصل الطلب لفريق جارك، ونبلغك بموعد التصوير ثم عند انتهائه.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`photo-notes-${unitId}`}>ملاحظات للمصوّر (اختياري)</Label>
            <Textarea
              id={`photo-notes-${unitId}`}
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: أفضل وقت بعد العصر — المفتاح عند حارس العمارة"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              إلغاء
            </Button>
            <Button onClick={() => request.mutate()} disabled={request.isPending}>
              {request.isPending ? "جارٍ الإرسال…" : "إرسال الطلب"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
