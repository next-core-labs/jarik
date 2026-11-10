import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, ImagePlus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { PageHeader } from "@/components/app-shell";
import { AddClientDialog } from "@/components/add-client-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { arNum } from "@/lib/format";
import { Avatar } from "@/components/listing-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { listClientAccounts } from "@/lib/admin-users.functions";
import { parseSaudiMobile } from "@/lib/public-form";
import { isStaffRole, useMyRoles } from "@/lib/use-role";
import { compressImage, mediaUrl, uploadListingImage, validateImageFile } from "@/lib/unit-photos";

export const Route = createFileRoute("/_authenticated/owner-pages")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "الملاك والمستأجرون — جارك" },
      {
        name: "description",
        content: "ملاك المكتب ومستأجروه: إضافتهم برقمهم التعريفي أو بالبريد، وصفحة عامة لكل مالك.",
      },
    ],
  }),
  component: OwnerPages,
});

type PageRow = {
  owner_id: string;
  display_name: string;
  bio: string | null;
  areas: string | null;
  property_types: string | null;
  phone: string | null;
  whatsapp: string | null;
  avatar_path: string | null;
  published: boolean;
};

type Account = { id: string; email: string; fullName: string; roles: string[] };

function OwnerPages() {
  const { data: me } = useMyRoles();
  const staff = isStaffRole(me?.roles ?? []);
  const fetchAccounts = useServerFn(listClientAccounts);
  const [tab, setTab] = useState<"owners" | "tenants">("owners");
  const [adding, setAdding] = useState<"owner" | "tenant" | null>(null);

  const accounts = useQuery({
    queryKey: ["client-accounts"],
    enabled: staff,
    queryFn: () => fetchAccounts() as Promise<Account[]>,
  });
  const pages = useQuery({
    queryKey: ["owner-pages"],
    enabled: staff,
    queryFn: async (): Promise<PageRow[]> => {
      const { data, error } = await supabase
        .from("owner_pages")
        .select(
          "owner_id, display_name, bio, areas, property_types, phone, whatsapp, avatar_path, published",
        );
      if (error) throw error;
      return data;
    },
  });
  // The office's tenant records (RLS: this office's only) — with or without a Jarak account.
  const tenants = useQuery({
    queryKey: ["office-tenants"],
    enabled: staff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, full_name, phone, email, user_id, leases(status, units(unit_number, unit_name, properties(name)))",
        )
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (me && !staff) {
    return (
      <>
        <PageHeader title="الملاك والمستأجرون" />
        <p className="text-muted-foreground">هذه الشاشة لموظفي المكتب.</p>
      </>
    );
  }

  const owners = (accounts.data ?? []).filter((a) => a.roles.includes("owner"));
  const byOwner = new Map((pages.data ?? []).map((p) => [p.owner_id, p]));
  const tenantRows = tenants.data ?? [];

  return (
    <>
      <PageHeader
        title="الملاك والمستأجرون"
        subtitle="أضف ملاك مكتبك ومستأجريه برقمهم التعريفي أو بالبريد، وابنِ لكل مالك صفحة عامة تظهر عليها عروضه في سوق العروض."
        action={
          <Button onClick={() => setAdding(tab === "owners" ? "owner" : "tenant")}>
            <UserPlus className="size-4" />
            {tab === "owners" ? "إضافة مالك" : "إضافة مستأجر"}
          </Button>
        }
      />
      <AddClientDialog
        kind={adding ?? "owner"}
        open={adding !== null}
        onOpenChange={(v) => !v && setAdding(null)}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as "owners" | "tenants")}>
        <TabsList className="mb-4">
          <TabsTrigger value="owners">الملاك ({arNum(owners.length)})</TabsTrigger>
          <TabsTrigger value="tenants">المستأجرون ({arNum(tenantRows.length)})</TabsTrigger>
        </TabsList>

        <TabsContent value="owners">
          {accounts.isLoading || pages.isLoading ? (
            <Skeleton className="h-64" />
          ) : owners.length === 0 ? (
            <Card className="shadow-deed">
              <CardContent className="space-y-4 py-10 text-center text-muted-foreground">
                <p>لا يوجد ملاك مرتبطون بمكتبك بعد.</p>
                <Button variant="outline" onClick={() => setAdding("owner")}>
                  <UserPlus className="size-4" />
                  إضافة مالك
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                لكل مالك صفحة عامة (الاسم والصورة والنبذة) تُنشر لتظهر عروضه في سوق العروض. اربط
                الوحدات بالمالك من «الأملاك والوحدات».
              </p>
              {owners.map((a) => (
                <OwnerPageCard key={a.id} account={a} page={byOwner.get(a.id) ?? null} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tenants">
          {tenants.isLoading ? (
            <Skeleton className="h-64" />
          ) : tenantRows.length === 0 ? (
            <Card className="shadow-deed">
              <CardContent className="space-y-4 py-10 text-center text-muted-foreground">
                <p>لا يوجد مستأجرون بعد.</p>
                <Button variant="outline" onClick={() => setAdding("tenant")}>
                  <UserPlus className="size-4" />
                  إضافة مستأجر
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {tenantRows.map((t) => {
                const active = t.leases?.find((l) => l.status === "active");
                const unit = active?.units;
                return (
                  <Card key={t.id} className="shadow-deed">
                    <CardContent className="space-y-1.5 pt-6 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{t.full_name}</p>
                        <Badge variant={t.user_id ? "secondary" : "outline"}>
                          {t.user_id ? "مرتبط بحساب" : "بدون حساب"}
                        </Badge>
                      </div>
                      {t.phone || t.email ? (
                        <p className="text-xs text-muted-foreground">
                          {t.phone ? <span dir="ltr">{t.phone}</span> : null}
                          {t.phone && t.email ? " · " : null}
                          {t.email ? <span dir="ltr">{t.email}</span> : null}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {unit
                          ? `عقد ساري: ${unit.properties?.name ?? ""} · ${unit.unit_name || `وحدة ${unit.unit_number}`}`
                          : "لا يوجد عقد ساري"}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            العقود ودعوات الدخول للمستأجرين من{" "}
            <Link to="/tenants" className="underline underline-offset-4">
              المستأجرون والعقود
            </Link>
            .
          </p>
        </TabsContent>
      </Tabs>
    </>
  );
}

function OwnerPageCard({ account, page }: { account: Account; page: PageRow | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PageRow>(
    page ?? {
      owner_id: account.id,
      display_name: account.fullName || "",
      bio: "",
      areas: "",
      property_types: "",
      phone: "",
      whatsapp: "",
      avatar_path: null,
      published: false,
    },
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // Pick up the saved row when it arrives or changes after a save.
  useEffect(() => {
    if (page) setForm(page);
  }, [page]);

  const set = <K extends keyof PageRow>(key: K, value: PageRow[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const problem = validateImageFile(file);
      if (problem) throw new Error(problem);
      const blob = await compressImage(file, 600);
      return uploadListingImage(supabase, `owners/${account.id}`, blob);
    },
    onSuccess: (path) => set("avatar_path", path),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر رفع الصورة")),
  });

  // Both numbers are optional (an empty phone falls back to the office's), but when given they are
  // shown publicly and dialled, so they must be Saudi mobiles. Saved in the local form 05XXXXXXXX.
  const phone = form.phone?.trim() ? parseSaudiMobile(form.phone) : null;
  const whatsapp = form.whatsapp?.trim() ? parseSaudiMobile(form.whatsapp) : null;
  const phoneError =
    form.phone?.trim() && !phone ? "رقم الاتصال غير صحيح — مثال: 05xxxxxxxx" : null;
  const whatsappError =
    form.whatsapp?.trim() && !whatsapp ? "رقم واتساب غير صحيح — مثال: 05xxxxxxxx" : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!form.display_name.trim()) throw new Error("اكتب اسم المالك كما سيظهر للعموم");
      if (phoneError || whatsappError) throw new Error(phoneError ?? whatsappError ?? "");
      const { error } = await supabase.from("owner_pages").upsert({
        owner_id: account.id,
        display_name: form.display_name.trim(),
        bio: form.bio?.trim() || null,
        areas: form.areas?.trim() || null,
        property_types: form.property_types?.trim() || null,
        phone,
        whatsapp,
        avatar_path: form.avatar_path,
        published: form.published,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.published ? "تم حفظ الصفحة ونشرها" : "تم حفظ الصفحة (غير منشورة)");
      queryClient.invalidateQueries({ queryKey: ["owner-pages"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحفظ")),
  });

  const image = form.avatar_path ? mediaUrl(form.avatar_path) : null;

  return (
    <Card className="shadow-deed">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar src={image} name={form.display_name || account.email} className="size-12" />
          <div className="min-w-0">
            <CardTitle className="truncate text-base">
              {form.display_name || account.email}
            </CardTitle>
            <p className="truncate text-xs text-muted-foreground" dir="ltr">
              {account.email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {page ? (
            <Badge variant={page.published ? "default" : "secondary"}>
              {page.published ? "منشورة" : "غير منشورة"}
            </Badge>
          ) : (
            <Badge variant="outline">بلا صفحة</Badge>
          )}
          {page?.published ? (
            <Button size="sm" variant="ghost" asChild>
              <Link to="/owner/$ownerId" params={{ ownerId: account.id }} target="_blank">
                <ExternalLink className="size-4" />
                عرض
              </Link>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "إخفاء" : page ? "تعديل" : "بناء الصفحة"}
          </Button>
        </div>
      </CardHeader>

      {open ? (
        <CardContent className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div className="flex items-center gap-4 sm:col-span-2">
            <Avatar src={image} name={form.display_name || "؟"} className="size-20" />
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="size-4" />
                {upload.isPending ? "جارٍ الرفع…" : image ? "تغيير الصورة" : "رفع صورة"}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                صورة شخصية أو شعار — تُصغَّر تلقائيًا.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                aria-label="صورة صفحة المالك"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <Field label="الاسم الذي يظهر للعموم">
            <Input
              value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
            />
          </Field>
          <Field label="أنواع العقارات">
            <Input
              value={form.property_types ?? ""}
              onChange={(e) => set("property_types", e.target.value)}
              placeholder="مثال: شقق، فلل، محلات"
            />
          </Field>
          <Field label="مناطق العمل">
            <Input
              value={form.areas ?? ""}
              onChange={(e) => set("areas", e.target.value)}
              placeholder="مثال: الرياض — الملقا، النرجس"
            />
          </Field>
          <Field label="رقم الاتصال (اتركه فارغًا لاستخدام رقم المكتب)">
            <Input
              dir="ltr"
              inputMode="tel"
              value={form.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="05xxxxxxxx"
              aria-invalid={Boolean(phoneError)}
            />
            {phoneError ? <p className="text-xs text-destructive">{phoneError}</p> : null}
          </Field>
          <Field label="رقم واتساب (اختياري)">
            <Input
              dir="ltr"
              inputMode="tel"
              value={form.whatsapp ?? ""}
              onChange={(e) => set("whatsapp", e.target.value)}
              placeholder="05xxxxxxxx"
              aria-invalid={Boolean(whatsappError)}
            />
            {whatsappError ? <p className="text-xs text-destructive">{whatsappError}</p> : null}
          </Field>
          <div className="sm:col-span-2">
            <Field label="نبذة تعريفية">
              <Textarea
                rows={4}
                maxLength={800}
                value={form.bio ?? ""}
                onChange={(e) => set("bio", e.target.value)}
                placeholder="تعريف مختصر بالمالك أو بالعقارات المعروضة…"
              />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 sm:col-span-2">
            <div>
              <Label htmlFor={`pub-${account.id}`}>نشر الصفحة للعموم</Label>
              <p className="text-xs text-muted-foreground">
                عند النشر تظهر الصفحة ويُنسب إليه ما يملكه من وحدات شاغرة في سوق العروض.
              </p>
            </div>
            <Switch
              id={`pub-${account.id}`}
              checked={form.published}
              onCheckedChange={(v) => set("published", v)}
            />
          </div>

          <div className="sm:col-span-2">
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending || upload.isPending || Boolean(phoneError) || Boolean(whatsappError)
              }
            >
              حفظ الصفحة
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
