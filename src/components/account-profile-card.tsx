import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Copy } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { avatarUrl, uploadAvatar } from "@/lib/avatar";
import { compressImage, validateImageFile } from "@/lib/unit-photos";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/** بطاقة الحساب المشتركة: صورة، اسم قابل للتعديل، والرقم التعريفي (لبدء محادثة معك من أي حساب
 * آخر). تُركَّب في أعلى صفحات الإعدادات الثلاث (المكتب/المالك/المستأجر). */
export function AccountProfileCard() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);

  const profile = useQuery({
    queryKey: ["my-account-profile"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return null;
      const [{ data: row }, { data: code }] = await Promise.all([
        supabase.from("profiles").select("full_name, avatar_path").eq("id", userId).maybeSingle(),
        supabase.rpc("my_reference_code"),
      ]);
      return {
        userId,
        fullName: row?.full_name ?? "",
        avatarPath: row?.avatar_path ?? null,
        referenceCode: code ?? null,
      };
    },
  });

  useEffect(() => {
    if (profile.data && !dirty) setName(profile.data.fullName);
  }, [profile.data, dirty]);

  const saveName = useMutation({
    mutationFn: async () => {
      const userId = profile.data?.userId;
      if (!userId) throw new Error("انتهت الجلسة، أعد الدخول");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name.trim() })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ الاسم");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["my-account-profile"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر الحفظ"),
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
    onError: (e: Error) => toast.error(e.message || "تعذّر رفع الصورة"),
  });

  function copyCode() {
    const code = profile.data?.referenceCode;
    if (!code) return;
    navigator.clipboard?.writeText(code).then(
      () => toast.success("نُسخ الرقم"),
      () => toast.error("تعذّر النسخ"),
    );
  }

  if (profile.isLoading) return <Skeleton className="h-44 max-w-md" />;

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
            <label className="absolute -bottom-1 -end-1 flex size-6 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Camera className="size-3.5" />
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
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
                onChange={(e) => {
                  setName(e.target.value);
                  setDirty(true);
                }}
              />
              <Button
                size="sm"
                disabled={!dirty || saveName.isPending}
                onClick={() => saveName.mutate()}
              >
                حفظ
              </Button>
            </div>
          </div>
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
