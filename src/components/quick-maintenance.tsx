import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Mic, Send, Square, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { submitQuickMaintenance } from "@/lib/office-tools.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

/** طلب صيانة سريع: عنوان + صورة من الجوال + وصف صوتي يتحوّل نصًا بالذكاء الاصطناعي. */
export function QuickMaintenance() {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Leaving the page while recording must not leave the microphone open.
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") {
        rec.onstop = null;
        rec.stop();
      }
      releaseMic();
    },
    [],
  );

  // One object URL per recording, revoked when it changes (creating it inline on every render
  // leaked a blob each keystroke and reset the audio player).
  const audioUrl = useMemo(() => (audio ? URL.createObjectURL(audio) : null), [audio]);
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined;
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        setAudio(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
        releaseMic();
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch {
      releaseMic(); // e.g. MediaRecorder threw after getUserMedia succeeded
      toast.error("تعذّر تشغيل الميكروفون — تأكد من الإذن");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const submit = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("سجّل دخولك أولًا");

      let photoPath: string | undefined;
      let audioPath: string | undefined;

      if (photo) {
        photoPath = `${uid}/photo-${Date.now()}.jpg`;
        const { error } = await supabase.storage
          .from("maintenance-media")
          .upload(photoPath, photo, { contentType: photo.type || "image/jpeg" });
        if (error) throw new Error("تعذّر رفع الصورة — حاول مرة أخرى");
      }
      if (audio) {
        const ext = audio.type.includes("ogg") ? "ogg" : "webm";
        audioPath = `${uid}/voice-${Date.now()}.${ext}`;
        const { error } = await supabase.storage
          .from("maintenance-media")
          .upload(audioPath, audio, { contentType: audio.type || "audio/webm" });
        if (error) throw new Error("تعذّر رفع التسجيل الصوتي — حاول مرة أخرى");
      }

      return submitQuickMaintenance({
        data: {
          title,
          ...(desc ? { description: desc } : {}),
          ...(photoPath ? { photoPath } : {}),
          ...(audioPath ? { audioPath } : {}),
        },
      });
    },
    onSuccess: (res) => {
      toast.success(
        res.transcript
          ? "وصل طلبك للمكتب — وحوّلنا وصفك الصوتي إلى نص مكتوب"
          : "وصل طلبك للمكتب بنجاح",
      );
      setTitle("");
      setDesc("");
      setPhoto(null);
      setAudio(null);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الطلب")),
  });

  return (
    <Card className="mb-6 border-brass/40 shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="size-4 text-brass" />
          طلب صيانة سريع
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>باختصار — ما المشكلة؟</Label>
          <Input
            placeholder="مثال: تسريب مياه تحت المغسلة"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>تفاصيل إضافية (اختياري)</Label>
          <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted/50">
            <ImagePlus className="size-4" />
            {photo ? photo.name.slice(0, 18) : "أرفق صورة"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </label>

          {recording ? (
            <Button type="button" size="sm" variant="destructive" onClick={stopRecording}>
              <Square className="size-4" />
              إيقاف التسجيل
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={startRecording}>
              <Mic className="size-4" />
              {audio ? "أعد التسجيل" : "سجّل وصفًا صوتيًا"}
            </Button>
          )}

          {audio && audioUrl && !recording ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <audio controls src={audioUrl} className="h-8" />
              <button
                type="button"
                aria-label="حذف التسجيل"
                onClick={() => setAudio(null)}
                className="text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </span>
          ) : null}
        </div>

        <Button
          disabled={submit.isPending || title.trim().length < 2}
          onClick={() => submit.mutate()}
        >
          <Send className="size-4" />
          {submit.isPending ? "جارٍ الإرسال…" : "أرسل الطلب"}
        </Button>
        <p className="text-xs text-muted-foreground">
          الوصف الصوتي يتحوّل نصًا تلقائيًا بالذكاء الاصطناعي ويصل للمكتب مع صورة الطلب.
        </p>
      </CardContent>
    </Card>
  );
}
