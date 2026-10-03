import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ImagePlus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { AccountProfileCard } from "@/components/account-profile-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { compressImage, mediaUrl, uploadListingImage, validateImageFile } from "@/lib/unit-photos";
import { useOrgBranding } from "@/lib/use-org-branding";
import { useMyRoles, isStaffRole } from "@/lib/use-role";

export const Route = createFileRoute("/_authenticated/settings")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "هوية المكتب — جارك" },
      {
        name: "description",
        content: "شعار المكتب واسمه ورقم ترخيص فال ورقم الجوال والرقم الضريبي والسجل التجاري.",
      },
      { property: "og:title", content: "هوية المكتب — جارك" },
      {
        property: "og:description",
        content: "إعدادات هوية المكتب العقاري وظهوره في دليل المكاتب.",
      },
    ],
  }),
  component: Settings,
});

function Settings() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const canEdit = isStaffRole(me?.roles ?? []);
  const isAdmin = !!me?.roles.includes("admin");
  const { org, logoDataUrl } = useOrgBranding();

  const [form, setForm] = useState({
    company_name: "",
    fal_license_no: "",
    office_phone: "",
    city: "",
    district: "",
    office_code: "",
    vat_number: "",
    cr_number: "",
    listed_publicly: true,
    whatsapp_locked: true,
  });

  useEffect(() => {
    const o = org.data;
    if (!o) return;
    setForm({
      company_name: o.company_name ?? "",
      fal_license_no: o.fal_license_no ?? "",
      office_phone: o.office_phone ?? "",
      city: o.city ?? "",
      district: o.district ?? "",
      office_code: o.office_code ?? "",
      vat_number: o.vat_number ?? "",
      cr_number: o.cr_number ?? "",
      listed_publicly: o.listed_publicly ?? true,
      whatsapp_locked: o.whatsapp_locked ?? true,
    });
  }, [org.data]);

  const set = (key: keyof typeof form, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const id = org.data?.id;
      if (!id) throw new Error("لا توجد إعدادات للمكتب");
      const { error } = await supabase
        .from("org_settings")
        .update({
          company_name: form.company_name.trim(),
          fal_license_no: form.fal_license_no.trim() || null,
          office_phone: form.office_phone.trim() || null,
          city: form.city.trim() || null,
          district: form.district.trim() || null,
          office_code: form.office_code.trim() || null,
          vat_number: form.vat_number.trim() || null,
          cr_number: form.cr_number.trim() || null,
          listed_publicly: form.listed_publicly,
          // Only an admin may change the lock (the database enforces it too). Sending the field
          // for everyone made a non-admin save fail whenever their form value was stale.
          ...(isAdmin ? { whatsapp_locked: form.whatsapp_locked } : {}),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ هوية المكتب");
      queryClient.invalidateQueries({ queryKey: ["org-branding"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر الحفظ"),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const id = org.data?.id;
      if (!id) throw new Error("لا توجد إعدادات للمكتب");
      // The branding bucket only accepts files inside the office's own folder.
      const path = `${id}/logo-${Date.now()}-${file.name.replace(/[^\w.-]/g, "")}`;
      const up = await supabase.storage.from("branding").upload(path, file, { upsert: true });
      if (up.error) throw up.error;
      const { error } = await supabase.from("org_settings").update({ logo_url: path }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم رفع الشعار");
      queryClient.invalidateQueries({ queryKey: ["org-branding"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر رفع الشعار"),
  });

  return (
    <>
      <PageHeader
        title="هوية المكتب"
        subtitle="الشعار واسم المكتب ورقم ترخيص فال ورقم الجوال — تظهر للمالك والمستأجر وفي دليل المكاتب."
      />

      <div className="mb-6">
        <AccountProfileCard />
      </div>

      {org.isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card className="max-w-3xl shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">بيانات المكتب</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-4 sm:col-span-2">
              {logoDataUrl ? (
                <img
                  src={logoDataUrl}
                  alt="شعار المكتب"
                  className="h-16 w-16 rounded-md object-contain"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                  الشعار
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">علامة المكتب التجارية</Label>
                <Input
                  type="file"
                  accept="image/*"
                  disabled={!canEdit || uploadLogo.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogo.mutate(file);
                  }}
                />
              </div>
            </div>

            <F label="اسم المكتب">
              <Input
                value={form.company_name}
                disabled={!canEdit}
                onChange={(e) => set("company_name", e.target.value)}
              />
            </F>
            <F label="رقم ترخيص فال">
              <Input
                dir="ltr"
                value={form.fal_license_no}
                disabled={!canEdit}
                onChange={(e) => set("fal_license_no", e.target.value)}
              />
            </F>
            <F label="رقم الجوال">
              <Input
                dir="ltr"
                value={form.office_phone}
                disabled={!canEdit}
                onChange={(e) => set("office_phone", e.target.value)}
              />
            </F>
            <F label="شفرة المكتب">
              <Input
                value={form.office_code}
                disabled={!canEdit}
                onChange={(e) => set("office_code", e.target.value)}
              />
            </F>
            <F label="المدينة">
              <Input
                value={form.city}
                disabled={!canEdit}
                onChange={(e) => set("city", e.target.value)}
              />
            </F>
            <F label="الحي">
              <Input
                value={form.district}
                disabled={!canEdit}
                onChange={(e) => set("district", e.target.value)}
              />
            </F>
            <F label="الرقم الضريبي">
              <Input
                dir="ltr"
                value={form.vat_number}
                disabled={!canEdit}
                onChange={(e) => set("vat_number", e.target.value)}
              />
            </F>
            <F label="السجل التجاري">
              <Input
                dir="ltr"
                value={form.cr_number}
                disabled={!canEdit}
                onChange={(e) => set("cr_number", e.target.value)}
              />
            </F>

            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 sm:col-span-2">
              <Label htmlFor="listed">إظهار المكتب في دليل المكاتب حسب الحي</Label>
              <Switch
                id="listed"
                checked={form.listed_publicly}
                disabled={!canEdit}
                onCheckedChange={(v) => set("listed_publicly", v)}
              />
            </div>

            {isAdmin ? (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 sm:col-span-2">
                <div>
                  <Label htmlFor="wa-lock">تفعيل ربط واتساب المكاتب</Label>
                  <p className="text-xs text-muted-foreground">
                    مفتاح الإدارة — المكتب يرى «الواتساب مقفل حاليًا، تواصل مع الإدارة لتفعيل
                    الربط».
                  </p>
                </div>
                <Switch
                  id="wa-lock"
                  checked={!form.whatsapp_locked}
                  disabled={!canEdit}
                  onCheckedChange={(v) => set("whatsapp_locked", !v)}
                />
              </div>
            ) : null}

            {canEdit ? (
              <div className="sm:col-span-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  حفظ هوية المكتب
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {org.data?.id ? <OfficePageCard orgId={org.data.id} canEdit={canEdit} /> : null}
    </>
  );
}

/** The office's public page: cover banner and a short bio, shown to everyone in the offers market. */
function OfficePageCard({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState("");
  const [banner, setBanner] = useState<string | null>(null);

  // Separate query on purpose: these two columns are new, and the rest of the screen must keep
  // working on a database that does not have them yet.
  const fields = useQuery({
    queryKey: ["office-page-fields", orgId],
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_settings")
        .select("bio, banner_path")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    if (!fields.data) return;
    setBio(fields.data.bio ?? "");
    setBanner(fields.data.banner_path);
  }, [fields.data]);

  const uploadBanner = useMutation({
    mutationFn: async (file: File) => {
      const problem = validateImageFile(file);
      if (problem) throw new Error(problem);
      return uploadListingImage(supabase, `offices/${orgId}`, await compressImage(file, 1600));
    },
    onSuccess: (path) => setBanner(path),
    onError: (e: Error) => toast.error(e.message || "تعذّر رفع الغلاف"),
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("org_settings")
        .update({ bio: bio.trim() || null, banner_path: banner })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ صفحة المكتب");
      queryClient.invalidateQueries({ queryKey: ["office-page-fields", orgId] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر الحفظ"),
  });

  if (fields.isError) return null; // columns not available yet

  return (
    <Card className="mt-6 max-w-3xl shadow-deed">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">صفحة المكتب في سوق العروض</CardTitle>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/office/$officeId" params={{ officeId: orgId }} target="_blank">
            <ExternalLink className="size-4" />
            عرض الصفحة
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          يظهر شعار المكتب وبياناته مع عروضك في الصفحة الرئيسية. أضف غلافًا ونبذة لصفحة مكتبك. (تظهر
          الصفحة للعموم فقط عند تفعيل «إظهار المكتب في دليل المكاتب» أعلاه.)
        </p>
        <div>
          <div
            className="flex h-28 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted bg-cover bg-center text-sm text-muted-foreground"
            style={banner ? { backgroundImage: `url(${mediaUrl(banner)})` } : undefined}
          >
            {banner ? null : "لا يوجد غلاف"}
          </div>
          {canEdit ? (
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploadBanner.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="size-4" />
                {uploadBanner.isPending ? "جارٍ الرفع…" : banner ? "تغيير الغلاف" : "رفع غلاف"}
              </Button>
              {banner ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setBanner(null)}>
                  إزالة الغلاف
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadBanner.mutate(f);
                  e.target.value = "";
                }}
              />
            </div>
          ) : null}
        </div>
        <F label="نبذة عن المكتب">
          <Textarea
            rows={4}
            maxLength={1000}
            disabled={!canEdit}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="تعريف مختصر بالمكتب وخدماته ومناطق عمله…"
          />
        </F>
        {canEdit ? (
          <Button onClick={() => save.mutate()} disabled={save.isPending || uploadBanner.isPending}>
            حفظ صفحة المكتب
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
