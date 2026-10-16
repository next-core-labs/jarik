import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { askAssistant } from "@/lib/assistant.functions";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/assistant")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "المساعد الذكي — جارك" },
      {
        name: "description",
        content: "مساعد عربي يحلل التحصيل والصيانة، يكتب إعلانات الوحدات، ويفهم رسائل واتساب.",
      },
      { property: "og:title", content: "المساعد الذكي — جارك" },
      { property: "og:description", content: "مساعد تشغيلي عربي لإدارة الأملاك." },
    ],
  }),
  component: Assistant,
});

type Mode = "assistant" | "listing" | "whatsapp";
type Msg = { role: "user" | "assistant"; content: string };

const modeHints: Record<Mode, string> = {
  assistant: "اسأل عن المتأخرات، الشواغر، أو ما يجب عمله هذا الأسبوع.",
  listing: "اكتب تفاصيل الوحدة (الموقع، المساحة، الغرف، السعر) ليصوغ إعلانًا جاهزًا للنشر.",
  whatsapp: "الصق رسالة المستأجر كما وصلت، ليحدد النية والإجراء ونص الرد.",
};

function Assistant() {
  const [mode, setMode] = useState<Mode>("assistant");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const ask = useServerFn(askAssistant);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const next: Msg[] = [...messages, { role: "user", content: text }];
      setMessages(next);
      const result = await ask({ data: { messages: next, mode } });
      return result.reply;
    },
    onSuccess: (reply) => setMessages((m) => [...m, { role: "assistant", content: reply }]),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحصول على رد")),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    send.mutate(text);
  }

  return (
    <>
      <PageHeader
        title="المساعد الذكي"
        subtitle="يحلّل الوضع التشغيلي، يكتب إعلانات الوحدات، ويفهم رسائل المستأجرين."
      />

      <Tabs
        value={mode}
        onValueChange={(v) => {
          setMode(v as Mode);
          setMessages([]);
        }}
      >
        <TabsList>
          <TabsTrigger value="assistant">مساعد التشغيل</TabsTrigger>
          <TabsTrigger value="listing">كتابة إعلان</TabsTrigger>
          <TabsTrigger value="whatsapp">رسالة واتساب</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="mt-4 shadow-deed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-brass" />
            {modeHints[mode]}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="min-h-64 space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">ابدأ بكتابة سؤالك أو النص بالأسفل.</p>
            ) : null}
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "ms-auto bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.content}
              </div>
            ))}
            {send.isPending ? (
              <div className="max-w-[85%] rounded-lg bg-secondary px-4 py-3 text-sm text-muted-foreground">
                يكتب…
              </div>
            ) : null}
          </div>

          <form onSubmit={submit} className="mt-4 flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="رسالتك للمساعد"
              placeholder="اكتب هنا…"
              rows={2}
              className="resize-none"
            />
            <Button
              type="submit"
              disabled={send.isPending || !input.trim()}
              size="icon"
              className="h-10 w-10"
              aria-label="إرسال"
            >
              <Send className="size-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
