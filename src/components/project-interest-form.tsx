import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { userErrorMessage } from "@/lib/auth-errors";
import { translate, type Locale } from "@/lib/i18n";
import { parseSaudiMobile } from "@/lib/public-form";
import { submitProjectInterest } from "@/lib/projects.functions";
import type { ProjectModel } from "@/lib/projects";

/** «سجّل اهتمامك» في صفحة المشروع — يصل مكتب المشروع إشعارًا، ولا يظهر للعموم. */
export function ProjectInterestForm({
  projectId,
  models,
  locale = "ar",
}: {
  projectId: string;
  models: ProjectModel[];
  locale?: Locale;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [modelId, setModelId] = useState("any");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const [touched, setTouched] = useState({ name: false, phone: false });

  const submit = useServerFn(submitProjectInterest);
  const send = useMutation({
    mutationFn: async () =>
      await submit({
        data: {
          projectId,
          ...(modelId !== "any" ? { modelId } : {}),
          fullName: fullName.trim(),
          // يُرسل مطبّعًا 05XXXXXXXX كبقية نماذج الموقع العامة.
          phone: mobile ?? phone.trim(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      }),
    onSuccess: () => setDone(true),
    onError: (e: Error) => toast.error(userErrorMessage(e, t("pj_interest"))),
  });

  // رقم سعودي فعلًا، لا أي 9–15 رقمًا: نفس parseSaudiMobile الذي تستخدمه كل النماذج العامة —
  // وإلا وصل المكتب رقم لا يستطيع الاتصال به. والخطأ يُعرض بدل تعطيل الزر بصمت.
  const mobile = parseSaudiMobile(phone);
  const nameError = fullName.trim().length < 2 ? t("req_name_short") : null;
  const phoneError = mobile ? null : t("ld_req_phone_invalid");
  const showNameError = touched.name && fullName.trim() !== "" && nameError;
  const showPhoneError = touched.phone && phone.trim() !== "" && phoneError;
  const valid = !nameError && !phoneError;

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <CheckCircle2 className="size-8 text-brass" aria-hidden />
        <p className="text-sm font-medium">{t("pj_interest_done")}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDone(false);
            setFullName("");
            setPhone("");
            setNotes("");
            setModelId("any");
          }}
        >
          {t("pj_interest_another")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) send.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold">{t("pj_interest")}</h2>
        <p className="text-xs text-muted-foreground">{t("pj_interest_note")}</p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        {t("pj_interest_name")}
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          onBlur={() => setTouched((v) => ({ ...v, name: true }))}
          maxLength={120}
          required
          autoComplete="name"
          aria-invalid={showNameError ? true : undefined}
        />
        {showNameError ? <span className="text-xs text-destructive">{nameError}</span> : null}
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        {t("pj_interest_phone")}
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => setTouched((v) => ({ ...v, phone: true }))}
          dir="ltr"
          inputMode="tel"
          maxLength={15}
          required
          autoComplete="tel"
          placeholder="05xxxxxxxx"
          aria-invalid={showPhoneError ? true : undefined}
        />
        {showPhoneError ? <span className="text-xs text-destructive">{phoneError}</span> : null}
      </label>

      {models.length > 0 ? (
        <label className="flex flex-col gap-1.5 text-sm">
          {t("pj_interest_model")}
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger aria-label={t("pj_interest_model")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t("pj_interest_model_any")}</SelectItem>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        {t("pj_interest_notes")}
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={600}
        />
      </label>

      <Button type="submit" disabled={!valid || send.isPending}>
        {send.isPending ? t("pj_interest_sending") : t("pj_interest_send")}
      </Button>
    </form>
  );
}
