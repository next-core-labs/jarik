import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCirclePlus, MessagesSquare } from "lucide-react";
import { toast } from "sonner";

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
    onError: (e: Error) => toast.error(e.message || "تعذّر بدء المحادثة"),
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
              اكتب الرقم التعريفي المكوّن من 6 أرقام للحساب الذي تريد مراسلته — يجده في صفحة
              إعداداته.
            </DialogDescription>
          </DialogHeader>
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
