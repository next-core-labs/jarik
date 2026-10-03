import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Copy, MessageCircle, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { handleWhatsappMessage } from "@/lib/whatsapp.functions";
import { getWhatsappProvider } from "@/lib/whatsapp-out.functions";

import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "مساعد واتساب — جارك" },
      {
        name: "description",
        content:
          "كل مكتب يربط رقم واتساب الخاص به، والمساعد يحوّل رسائل المالك والمستأجر والفني إلى إشعارات وإجراءات.",
      },
      { property: "og:title", content: "مساعد واتساب — جارك" },
      { property: "og:description", content: "رسائل واتساب تتحول إلى مهام وإشعارات داخل المنصة." },
    ],
  }),
  component: WhatsappPage,
});

const providerLabel: Record<string, string> = {
  meta: "Meta WhatsApp Cloud",
  twilio: "Twilio",
  manual: "إدخال يدوي",
};

function WhatsappPage() {
  const queryClient = useQueryClient();
  const [officeName, setOfficeName] = useState("");
  const [phone, setPhone] = useState("");
  const [provider, setProvider] = useState("meta");
  const [testPhone, setTestPhone] = useState("");
  const [testBody, setTestBody] = useState("");
  const [testChannel, setTestChannel] = useState<string>("");

  const process = useServerFn(handleWhatsappMessage);
  const providerStatus = useServerFn(getWhatsappProvider);
  const providerInfo = useQuery({
    queryKey: ["whatsapp-provider"],
    queryFn: () => providerStatus({}),
  });

  const channels = useQuery({
    queryKey: ["whatsapp-channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_channels")
        .select("id, office_name, phone, provider, verify_token, is_active, created_at")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const messages = useQuery({
    queryKey: ["whatsapp-messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("id, phone, body, intent, sender_role, suggested_reply, action_taken, created_at")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data ?? [];
    },
  });

  const addChannel = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("انتهت الجلسة، أعد الدخول");
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      const { error } = await supabase.from("whatsapp_channels").insert({
        owner_id: userId,
        office_name: officeName.trim(),
        phone: phone.trim(),
        provider,
        verify_token: token,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setOfficeName("");
      setPhone("");
      toast.success("تم تسجيل رقم المكتب");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-channels"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تسجيل الرقم"),
  });

  const removeChannel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("whatsapp_channels").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-channels"] }),
    onError: (e: Error) => toast.error(e.message || "تعذّر الحذف"),
  });

  const runMessage = useMutation({
    mutationFn: async () =>
      process({
        data: {
          phone: testPhone.trim(),
          body: testBody.trim(),
          channelId: testChannel || null,
        },
      }),
    onSuccess: (result) => {
      setTestBody("");
      toast.success(`${result.intent} — ${result.actionTaken}`);
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تحليل الرسالة"),
  });

  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <>
      <PageHeader
        title="مساعد واتساب الذكي"
        subtitle="كل مكتب يسجّل رقمه، والمساعد يفهم رسائل المالك والمستأجر والفني ويحوّلها إلى إشعارات وأوامر صيانة."
      />

      <Card className="mb-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">حالة الإرسال الفعلي</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {providerInfo.data?.locked ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              <p className="font-medium">الواتساب مقفل حاليًا — تواصل مع الإدارة لتفعيل الربط</p>
              <p className="mt-1 text-xs text-destructive/80">
                كل الرسائل والتذكيرات تعمل داخل المنصة وتُحفظ في السجل، والإرسال الفعلي للأرقام
                متوقف حتى تفعّل الإدارة الربط.
              </p>
            </div>
          ) : providerInfo.data?.configured ? (
            <p className="text-muted-foreground">
              الإرسال الفعلي مفعّل عبر{" "}
              <Badge variant="secondary">
                {providerInfo.data.provider === "meta" ? "Meta WhatsApp Cloud" : "Twilio"}
              </Badge>{" "}
              — التذكيرات والموافقات والرسائل تخرج للأرقام تلقائيًا.
            </p>
          ) : (
            <p className="text-muted-foreground">
              كل التذكيرات والموافقات والرسائل تعمل داخل المنصة الآن، وتُحفظ في السجل بانتظار
              الإرسال. لتشغيل الإرسال الفعلي على واتساب أحتاج مفاتيح مزوّدك (Meta WhatsApp Cloud:
              معرّف الرقم ورمز الوصول، أو Twilio: معرّف الحساب ورمزه ورقم المرسل) — قل لي أيّهما
              عندك وأفتح لك نموذج إدخال آمن.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">أرقام واتساب المكاتب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>اسم المكتب</Label>
                <Input
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                  placeholder="مكتب الملقا"
                />
              </div>
              <div>
                <Label>رقم واتساب</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9665xxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div>
                <Label>المزوّد</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta">Meta WhatsApp Cloud</SelectItem>
                    <SelectItem value="twilio">Twilio</SelectItem>
                    <SelectItem value="manual">إدخال يدوي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={
                    !officeName.trim() ||
                    !phone.trim() ||
                    addChannel.isPending ||
                    providerInfo.data?.locked
                  }
                  onClick={() => addChannel.mutate()}
                >
                  <Plus className="size-4" />
                  إضافة الرقم
                </Button>
              </div>
            </div>

            {channels.isLoading ? (
              <Skeleton className="h-24" />
            ) : (
              <div className="space-y-3">
                {(channels.data ?? []).map((c) => {
                  // The receiver rejects calls without the channel token, so the URL carries it.
                  const hook = `${origin}/api/public/whatsapp/${c.id}${
                    c.verify_token ? `?token=${encodeURIComponent(c.verify_token)}` : ""
                  }`;
                  return (
                    <div key={c.id} className="rounded-md border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{c.office_name}</p>
                          <p className="text-sm text-muted-foreground" dir="ltr">
                            {c.phone}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {providerLabel[c.provider] ?? c.provider}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="حذف القناة"
                            onClick={() => removeChannel.mutate(c.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 text-xs">
                        <p className="text-muted-foreground">رابط الاستقبال (Webhook):</p>
                        <div className="flex items-center gap-2">
                          <code
                            className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1"
                            dir="ltr"
                          >
                            {hook}
                          </code>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="نسخ رابط الاستقبال"
                            onClick={() => {
                              navigator.clipboard.writeText(hook);
                              toast.success("تم نسخ الرابط");
                            }}
                          >
                            <Copy className="size-3.5" />
                          </Button>
                        </div>
                        <p className="text-muted-foreground">
                          رمز التحقق: <span dir="ltr">{c.verify_token}</span>
                        </p>
                      </div>
                    </div>
                  );
                })}
                {(channels.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    لا توجد أرقام مسجّلة. أضف رقم مكتبك ثم ضع رابط الاستقبال ورمز التحقق في حساب
                    واتساب الأعمال.
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-deed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="size-4 text-brass" />
              تجربة رسالة الآن
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              الصق رسالة كما تصل من المالك أو المستأجر أو الفني — يحدّد المساعد النية، ينشئ الإشعار،
              ويفتح أمر صيانة عند الحاجة.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>رقم المرسل</Label>
                <Input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="9665xxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div>
                <Label>القناة</Label>
                <Select value={testChannel} onValueChange={setTestChannel}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختياري" />
                  </SelectTrigger>
                  <SelectContent>
                    {(channels.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.office_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea
              rows={3}
              value={testBody}
              onChange={(e) => setTestBody(e.target.value)}
              placeholder="مثال: السلام عليكم، مكيف الصالة ما يبرد من أمس"
            />
            <Button
              disabled={
                !testPhone.trim() ||
                !testBody.trim() ||
                runMessage.isPending ||
                providerInfo.data?.locked
              }
              onClick={() => runMessage.mutate()}
            >
              <Send className="size-4" />
              تحليل وتحويل إلى إشعار
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">سجل الرسائل والإجراءات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            (messages.data ?? []).map((m) => (
              <div key={m.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" dir="ltr">
                    {m.phone}
                  </span>
                  {m.intent ? <Badge>{m.intent}</Badge> : null}
                  {m.action_taken ? <Badge variant="secondary">{m.action_taken}</Badge> : null}
                  <span className="text-xs text-muted-foreground">{shortDate(m.created_at)}</span>
                </div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{m.body}</p>
                {m.suggested_reply ? (
                  <p className="mt-2 rounded bg-secondary p-3 text-sm text-secondary-foreground whitespace-pre-wrap">
                    الرد المقترح: {m.suggested_reply}
                  </p>
                ) : null}
              </div>
            ))
          )}
          {!messages.isLoading && (messages.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد رسائل بعد.</p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
