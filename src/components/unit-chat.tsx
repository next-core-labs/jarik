import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const roleLabels: Record<string, string> = {
  staff: "المكتب",
  owner: "المالك",
  tenant: "المستأجر",
  unknown: "مشارك",
};

/** محادثة موحّدة لكل وحدة بين المكتب والمالك والمستأجر. */
export function UnitChat({
  unitId,
  myRole,
  myName,
}: {
  unitId: string;
  myRole: string;
  myName: string;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const thread = useQuery({
    queryKey: ["unit-messages", unitId],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_messages")
        .select("id, body, sender_id, sender_name, sender_role, created_at")
        .eq("unit_id", unitId)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const myId = useQuery({
    queryKey: ["my-user-id"],
    staleTime: 300_000,
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.data?.length]);

  const send = useMutation({
    mutationFn: async () => {
      const userId = myId.data;
      if (!userId) throw new Error("انتهت الجلسة، أعد الدخول");
      const { error } = await supabase.from("unit_messages").insert({
        unit_id: unitId,
        sender_id: userId,
        sender_name: myName,
        sender_role: myRole,
        body: body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["unit-messages", unitId] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال الرسالة"),
  });

  return (
    <div className="flex h-full min-h-[22rem] flex-col gap-3">
      <div className="min-h-[14rem] flex-1 space-y-3 overflow-y-auto rounded-md border border-border bg-muted/40 p-3">
        {thread.isLoading ? (
          <Skeleton className="h-24" />
        ) : (thread.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            لا توجد رسائل بعد — اكتب أول رسالة لبدء المحادثة.
          </p>
        ) : (
          (thread.data ?? []).map((m) => {
            const mine = m.sender_id === myId.data;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    mine ? "bg-foreground text-background" : "bg-card border border-border",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2 text-xs opacity-80">
                    <span>{m.sender_name ?? "مشارك"}</span>
                    <Badge
                      variant={mine ? "secondary" : "outline"}
                      className="h-4 px-1 text-[10px]"
                    >
                      {roleLabels[m.sender_role] ?? m.sender_role}
                    </Badge>
                    <span dir="ltr">
                      {new Date(m.created_at).toLocaleString("ar-SA", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="اكتب رسالتك..."
        />
        <Button disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>
          <Send className="size-4" />
          إرسال
        </Button>
      </div>
    </div>
  );
}
