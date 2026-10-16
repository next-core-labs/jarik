import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MessageCirclePlus, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { DirectChat } from "@/components/direct-chat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

/** قائمة المحادثات المباشرة + بدء محادثة جديدة برقم تعريفي — مشتركة بين /messages (أي حساب) و/hq
 * (المدير العام مع أي حساب مسجَّل). لا فرق دور بداخلها؛ start_direct_conversation/my_direct_conversations
 * تعملان لأي حسابين بلا قيد صلاحية. */
export function DirectMessagesTab({
  myName,
  selected,
  onSelect,
}: {
  myName: string;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [code, setCode] = useState("");

  const conversations = useQuery({
    queryKey: ["direct-conversations"],
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_direct_conversations");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  // The caller's own ID, shown in the dialog: not every account has a settings page to find it in
  // (technicians don't), and the other person needs it to start a chat back.
  const myCode = useQuery({
    queryKey: ["my-reference-code"],
    enabled: dialogOpen,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_reference_code");
      if (error) throw new Error(error.message);
      return data ?? null;
    },
  });

  const copyMyCode = () => {
    const mine = myCode.data;
    if (!mine) return;
    navigator.clipboard?.writeText(mine).then(
      () => toast.success("نُسخ رقمك"),
      () => toast.error("تعذّر النسخ"),
    );
  };

  const list = conversations.data ?? [];
  const active = selected ?? list[0]?.id ?? null;

  const start = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("start_direct_conversation", {
        _code: code.trim(),
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: (conversationId) => {
      setDialogOpen(false);
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["direct-conversations"] });
      onSelect(conversationId);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر بدء المحادثة")),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <Card className="shadow-deed">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessagesSquare className="size-4 text-brass" />
            المحادثات
          </CardTitle>
          <Button
            size="icon"
            variant="ghost"
            aria-label="بدء محادثة"
            onClick={() => setDialogOpen(true)}
          >
            <MessageCirclePlus className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {conversations.isLoading ? (
            <Skeleton className="h-32" />
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد محادثات مباشرة بعد — ابدأ واحدة برقم أي حساب.
            </p>
          ) : (
            list.map((c) => (
              <Button
                key={c.id}
                variant="ghost"
                onClick={() => onSelect(c.id)}
                className={cn(
                  "w-full justify-start",
                  active === c.id && "bg-secondary text-secondary-foreground",
                )}
              >
                <span className="truncate">{c.other_full_name || "حساب بلا اسم"}</span>
              </Button>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">
            {active ? list.find((c) => c.id === active)?.other_full_name || "المحادثة" : "المحادثة"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {active ? (
            <DirectChat conversationId={active} myName={myName} />
          ) : (
            <p className="text-sm text-muted-foreground">ابدأ محادثة برقم أي حساب لتبدأ الكتابة.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">بدء محادثة</DialogTitle>
            <DialogDescription>
              اكتب الرقم التعريفي المكوّن من 6 أرقام للحساب الذي تريد مراسلته — اطلبه من صاحبه.
            </DialogDescription>
          </DialogHeader>
          {myCode.data ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span>
                رقمك التعريفي:{" "}
                <span dir="ltr" className="font-bold tracking-widest">
                  {myCode.data}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={copyMyCode}>
                <Copy className="size-4" />
                نسخ
              </Button>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="direct-code">الرقم التعريفي</Label>
            <Input
              id="direct-code"
              dir="ltr"
              inputMode="numeric"
              maxLength={6}
              className="text-center text-lg tracking-[0.4em]"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </div>
          <DialogFooter>
            <Button disabled={code.length !== 6 || start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? "جارٍ البحث..." : "بدء المحادثة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
