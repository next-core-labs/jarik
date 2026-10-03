import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, ImagePlus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
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
import { isStaffRole, useMyRoles } from "@/lib/use-role";
import { compressImage, mediaUrl, uploadListingImage, validateImageFile } from "@/lib/unit-photos";

export const Route = createFileRoute("/_authenticated/owner-pages")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "صفحات الملاك — جارك" },
      {
        name: "description",
        content: "ابنِ صفحة عامة لكل مالك: الاسم والصورة والنبذة وعروضه تظهر في سوق العروض.",
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

  if (me && !staff) {
    return (
      <>
        <PageHeader title="صفحات الملاك" />
        <p className="text-muted-foreground">هذه الشاشة لموظفي المكتب.</p>
      </>
    );
  }

  const owners = (accounts.data ?? []).filter((a) => a.roles.includes("owner"));
  const byOwner = new Map((pages.data ?? []).map((p) => [p.owner_id, p]));

  return (
    <>
      <PageHeader
        title="صفحات الملاك"
        subtitle="ابنِ صفحة عامة لكل مالك (الاسم والصورة والنبذة)، ثم انشرها لتظهر عروضه في سوق العروض. اربط الوحدات بالمالك من شاشة «الأملاك والوحدات»."
      />

      {accounts.isLoading || pages.isLoading ? (
        <Skeleton className="h-64" />
      ) : owners.length === 0 ? (
        <Card className="shadow-deed">
          <CardContent className="py-10 text-center text-muted-foreground">
            لا توجد حسابات بدور «مالك» بعد. أنشئ حسابًا للمالك ثم اسند له الدور من شاشة «المستخدمون
            والأدوار».
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {owners.map((a) => (
            <OwnerPageCard key={a.id} account={a} page={byOwner.get(a.id) ?? null} />
          ))}
        </div>
      )}
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
    onError: (e: Error) => toast.error(e.message || "تعذّر رفع الصورة"),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.display_name.trim()) throw new Error("اكتب اسم المالك كما سيظهر للعموم");
      const { error } = await supabase.from("owner_pages").upsert({
        owner_id: account.id,
        display_name: form.display_name.trim(),
        bio: form.bio?.trim() || null,
        areas: form.areas?.trim() || null,
        property_types: form.property_types?.trim() || null,
        phone: form.phone?.trim() || null,
        whatsapp: form.whatsapp?.trim() || null,
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
    onError: (e: Error) => toast.error(e.message || "تعذّر الحفظ"),
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
              value={form.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="05xxxxxxxx"
            />
          </Field>
          <Field label="رقم واتساب (اختياري)">
            <Input
              dir="ltr"
              value={form.whatsapp ?? ""}
              onChange={(e) => set("whatsapp", e.target.value)}
              placeholder="05xxxxxxxx"
            />
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
            <Button onClick={() => save.mutate()} disabled={save.isPending || upload.isPending}>
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
