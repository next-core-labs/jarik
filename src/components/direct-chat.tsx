import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** محادثة مباشرة بين أي حسابين (شخص لشخص، لا مقيّدة بوحدة) — نفس نمط UnitChat بدون شارة دور. */
export function DirectChat({ conversationId, myName }: { conversationId: string; myName: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const thread = useQuery({
    queryKey: ["direct-messages", conversationId],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("direct_messages")
        .select("id, body, sender_id, sender_name, created_at")
        .eq("conversation_id", conversationId)
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
      const { error } = await supabase.from("direct_messages").insert({
        conversation_id: conversationId,
        sender_id: userId,
        sender_name: myName,
        body: body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["direct-messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["direct-conversations"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الرسالة")),
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
