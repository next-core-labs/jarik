import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Copy } from "lucide-react";
import { toast } from "sonner";
import { emailProblem, userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { avatarUrl, uploadAvatar } from "@/lib/avatar";
import { parseSaudiMobile } from "@/lib/public-form";
import { compressImage, validateImageFile } from "@/lib/unit-photos";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const PHONE_ERROR = "رقم الجوال غير صحيح — مثال: 05xxxxxxxx";

/** بطاقة الحساب المشتركة: صورة، اسم وجوال وبريد قابلة للتعديل، والرقم التعريفي (لبدء محادثة معك
 * من أي حساب آخر). تُركَّب في أعلى صفحات الإعدادات الثلاث (المكتب/المالك/المستأجر). */
export function AccountProfileCard() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [phone, setPhone] = useState("");
  const [phoneDirty, setPhoneDirty] = useState(false);
  const [email, setEmail] = useState("");
  const [emailDirty, setEmailDirty] = useState(false);

  const profile = useQuery({
    queryKey: ["my-account-profile"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return null;
      const [{ data: row }, { data: code }] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, avatar_path, phone")
          .eq("id", userId)
          .maybeSingle(),
        supabase.rpc("my_reference_code"),
      ]);
      return {
        userId,
        fullName: row?.full_name ?? "",
        avatarPath: row?.avatar_path ?? null,
        phone: row?.phone ?? "",
        email: auth.user?.email ?? "",
        // Set while an email change waits for its confirmation link.
        pendingEmail: auth.user?.new_email ?? null,
        referenceCode: code ?? null,
      };
    },
  });

  useEffect(() => {
    if (profile.data && !dirty) setName(profile.data.fullName);
  }, [profile.data, dirty]);
  useEffect(() => {
    if (profile.data && !phoneDirty) setPhone(profile.data.phone);
  }, [profile.data, phoneDirty]);
  useEffect(() => {
    if (profile.data && !emailDirty) setEmail(profile.data.email);
  }, [profile.data, emailDirty]);

  const trimmedName = name.trim();
  const nameError = dirty && trimmedName.length < 2 ? "اكتب اسمك (حرفان على الأقل)" : null;
  // The phone is optional: empty clears it, anything else must be a Saudi mobile (saved as 05…).
  const trimmedPhone = phone.trim();
  const parsedPhone = trimmedPhone ? parseSaudiMobile(trimmedPhone) : null;
  const phoneError = phoneDirty && trimmedPhone && !parsedPhone ? PHONE_ERROR : null;
  const trimmedEmail = email.trim();
  const emailUnchanged = trimmedEmail.toLowerCase() === (profile.data?.email ?? "").toLowerCase();
  const emailError = emailDirty && !emailUnchanged ? emailProblem(trimmedEmail) : null;

  const saveName = useMutation({
    mutationFn: async () => {
      const userId = profile.data?.userId;
      if (!userId) throw new Error("انتهت الجلسة، أعد الدخول");
      if (trimmedName.length < 2) throw new Error("اكتب اسمك (حرفان على الأقل)");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: trimmedName })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ الاسم");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["my-account-profile"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحفظ")),
  });

  const savePhone = useMutation({
    mutationFn: async () => {
      const userId = profile.data?.userId;
      if (!userId) throw new Error("انتهت الجلسة، أعد الدخول");
      if (trimmedPhone && !parsedPhone) throw new Error(PHONE_ERROR);
      const { error } = await supabase
        .from("profiles")
        .update({ phone: parsedPhone })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(parsedPhone ? "تم حفظ رقم الجوال" : "حُذف رقم الجوال");
      setPhoneDirty(false);
      queryClient.invalidateQueries({ queryKey: ["my-account-profile"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حفظ رقم الجوال")),
  });

  // Supabase sends a confirmation link (to the new address, and to the current one when "secure
  // email change" is on); the account's email changes only once it is opened.
  const changeEmail = useMutation({
    mutationFn: async () => {
      const problem = emailProblem(trimmedEmail);
      if (problem) throw new Error(problem);
      const { data, error } = await supabase.auth.updateUser(
        { email: trimmedEmail },
        { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
      );
      if (error) {
        if (error.code === "email_exists") throw new Error("هذا البريد مسجّل لحساب آخر");
        if (error.code === "over_email_send_rate_limit") {
          throw new Error("أرسلنا رابطًا قبل قليل — انتظر دقيقة ثم أعد المحاولة");
        }
        throw error;
      }
      // A project without email confirmation applies the change at once.
      return { confirmed: data.user?.email?.toLowerCase() === trimmedEmail.toLowerCase() };
    },
    onSuccess: ({ confirmed }) => {
      toast.success(
        confirmed
          ? "تم تغيير البريد الإلكتروني"
          : "أرسلنا رابط تأكيد إلى بريدك الجديد — يتغيّر البريد بعد فتح الرابط",
      );
      setEmailDirty(false);
      queryClient.invalidateQueries({ queryKey: ["my-account-profile"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تغيير البريد الإلكتروني")),
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const userId = profile.data?.userId;
      if (!userId) throw new Error("انتهت الجلسة، أعد الدخول");
      const problem = validateImageFile(file);
      if (problem) throw new Error(problem);
      const blob = await compressImage(file, 512, 0.85);
      const path = await uploadAvatar(supabase, userId, blob);
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_path: path })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث الصورة");
      queryClient.invalidateQueries({ queryKey: ["my-account-profile"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر رفع الصورة")),
  });

  function copyCode() {
    const code = profile.data?.referenceCode;
    if (!code) return;
    navigator.clipboard?.writeText(code).then(
      () => toast.success("نُسخ الرقم"),
      () => toast.error("تعذّر النسخ"),
    );
  }

  if (profile.isLoading) return <Skeleton className="h-80 max-w-md" />;

  return (
    <Card className="max-w-md shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">حسابي</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <Avatar className="size-16 border border-border">
              {profile.data?.avatarPath ? (
                <AvatarImage src={avatarUrl(profile.data.avatarPath)} alt="" />
              ) : null}
              <AvatarFallback className="text-lg font-bold">
                {(profile.data?.fullName || "?").trim().slice(0, 1) || "؟"}
              </AvatarFallback>
            </Avatar>
            {/* The input is visually hidden but still focusable, and named for screen readers. */}
            <label
              title="تغيير الصورة الشخصية"
              className="absolute -bottom-1 -end-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
            >
              <Camera className="size-3.5" aria-hidden />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="تغيير الصورة الشخصية"
                className="sr-only"
                disabled={uploadPhoto.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadPhoto.mutate(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="account-name">الاسم</Label>
            <div className="flex gap-2">
              <Input
                id="account-name"
                value={name}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "account-name-error" : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
              <Button
                size="sm"
                disabled={!dirty || !!nameError || saveName.isPending}
                onClick={() => saveName.mutate()}
              >
                حفظ
              </Button>
            </div>
            {nameError ? (
              <p id="account-name-error" className="text-xs text-destructive">
                {nameError}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="account-phone">رقم الجوال</Label>
          <div className="flex gap-2">
            <Input
              id="account-phone"
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder="05xxxxxxxx"
              value={phone}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "account-phone-error" : undefined}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneDirty(true);
              }}
            />
            <Button
              size="sm"
              aria-label="حفظ رقم الجوال"
              disabled={!phoneDirty || !!phoneError || savePhone.isPending}
              onClick={() => savePhone.mutate()}
            >
              حفظ
            </Button>
          </div>
          {phoneError ? (
            <p id="account-phone-error" className="text-xs text-destructive">
              {phoneError}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="account-email">البريد الإلكتروني</Label>
          <div className="flex gap-2">
            <Input
              id="account-email"
              type="email"
              dir="ltr"
              autoComplete="email"
              value={email}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={
                emailError
                  ? "account-email-error"
                  : profile.data?.pendingEmail
                    ? "account-email-pending"
                    : undefined
              }
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailDirty(true);
              }}
            />
            <Button
              size="sm"
              aria-label="تغيير البريد الإلكتروني"
              disabled={!emailDirty || emailUnchanged || !!emailError || changeEmail.isPending}
              onClick={() => changeEmail.mutate()}
            >
              تغيير
            </Button>
          </div>
          {emailError ? (
            <p id="account-email-error" className="text-xs text-destructive">
              {emailError}
            </p>
          ) : profile.data?.pendingEmail ? (
            <p id="account-email-pending" className="text-xs text-muted-foreground">
              بانتظار التأكيد: أرسلنا رابطًا إلى <span dir="ltr">{profile.data.pendingEmail}</span>{" "}
              — يبقى بريدك الحالي حتى تفتحه.
            </p>
          ) : null}
        </div>

        <div>
          <Label>رقمك التعريفي</Label>
          <div className="mt-1 flex items-center gap-2">
            <span
              dir="ltr"
              className="rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-sm tracking-widest"
            >
              {profile.data?.referenceCode ?? "—"}
            </span>
            <Button size="icon" variant="ghost" aria-label="نسخ الرقم" onClick={copyCode}>
              <Copy className="size-4" />
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            شارك هذا الرقم مع أي حساب في جارك ليبدأ محادثة معك من صفحة المحادثات.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
