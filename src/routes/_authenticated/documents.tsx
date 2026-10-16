import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileText, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDays, todayRiyadh } from "@/lib/dates";
import { shortDate } from "@/lib/format";
import { useMyRoles, isStaffRole } from "@/lib/use-role";

export const Route = createFileRoute("/_authenticated/documents")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "وثائق العقارات — جارك" },
      {
        name: "description",
        content: "أرشيف الصكوك والتراخيص لكل عقار مع تنبيه قبل انتهاء الوثيقة بـ 60 يومًا.",
      },
      { property: "og:title", content: "وثائق العقارات — جارك" },
      { property: "og:description", content: "صكوك وتراخيص مؤرشفة مع تنبيهات الانتهاء." },
    ],
  }),
  component: Documents,
});

const kinds = [
  { value: "deed", label: "صك ملكية" },
  { value: "fal", label: "رخصة فال" },
  { value: "license", label: "رخصة بلدية" },
  { value: "insurance", label: "تأمين" },
  { value: "other", label: "أخرى" },
] as const;

const kindLabel: Record<string, string> = Object.fromEntries(kinds.map((k) => [k.value, k.label]));

function Documents() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const roles = me?.roles ?? [];
  const staff = isStaffRole(roles);
  const isTenant = roles.includes("tenant");
  // Office staff manage every property's deeds and licences; an owner sees their own properties'
  // documents; a tenant or technician only sees what the office shares with them.
  const header = staff
    ? {
        title: "وثائق العقارات",
        subtitle: "صكوك وتراخيص كل عقار في مكان واحد — والنظام ينبّهك قبل الانتهاء بـ 60 يومًا.",
      }
    : roles.includes("owner")
      ? {
          title: "وثائق عقاراتي",
          subtitle:
            "صكوك وتراخيص عقاراتك التي يحفظها المكتب — مع تنبيه قبل انتهاء أي وثيقة بـ 60 يومًا.",
        }
      : {
          title: "الوثائق",
          subtitle: isTenant
            ? "هنا تظهر الوثائق التي يشاركها معك المكتب. عقدك وإيصالات دفعاتك تجدها في لوحتك."
            : "هنا تظهر الوثائق التي يشاركها معك المكتب.",
        };

  const [propertyId, setPropertyId] = useState("");
  const [kind, setKind] = useState<string>("deed");
  const [title, setTitle] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const [docs, properties] = await Promise.all([
        supabase
          .from("property_documents")
          .select(
            "id, kind, title, doc_number, file_path, expires_at, notes, created_at, properties(name)",
          )
          .order("expires_at", { ascending: true, nullsFirst: false }),
        supabase.from("properties").select("id, name").order("name"),
      ]);
      if (docs.error) throw docs.error;
      return { docs: docs.data ?? [], properties: properties.data ?? [] };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      setSaving(true);
      let path: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() ?? "pdf";
        path = `${propertyId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("documents").upload(path, file);
        if (error) throw error;
      }
      const { error } = await supabase.from("property_documents").insert({
        property_id: propertyId,
        kind,
        title,
        doc_number: docNumber || null,
        file_path: path,
        expires_at: expiresAt || null,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("حُفظت الوثيقة");
      setTitle("");
      setDocNumber("");
      setExpiresAt("");
      setNotes("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: () => toast.error("تعذّر حفظ الوثيقة — الصلاحية لموظفي المكتب"),
    onSettled: () => setSaving(false),
  });

  const openFile = async (path: string) => {
    const { data: signed, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(path, 300);
    if (error || !signed) {
      toast.error("تعذّر فتح الملف");
      return;
    }
    window.open(signed.signedUrl, "_blank", "noopener");
  };

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title={header.title} />
        <Skeleton className="h-64" />
      </>
    );
  }

  const today = todayRiyadh();
  const soon = addDays(today, 60);
  const expiring = data.docs.filter(
    (d) => d.expires_at && d.expires_at >= today && d.expires_at <= soon,
  );
  const expired = data.docs.filter((d) => d.expires_at && d.expires_at < today);

  return (
    <>
      <PageHeader
        title={header.title}
        subtitle={header.subtitle}
        action={
          isTenant && !staff ? (
            <Button variant="outline" asChild>
              <Link to="/tenant-dashboard">عقدي ودفعاتي</Link>
            </Button>
          ) : undefined
        }
      />

      {expired.length + expiring.length > 0 ? (
        <Card className="mb-6 border-destructive/40 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base text-destructive">
              وثائق تحتاج تجديدًا ({expired.length + expiring.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...expired, ...expiring].map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
              >
                <p className="font-medium">
                  {kindLabel[d.kind] ?? d.kind} · {d.properties?.name ?? "—"}
                </p>
                <Badge variant={d.expires_at! < today ? "destructive" : "secondary"}>
                  {d.expires_at! < today
                    ? `منتهية منذ ${shortDate(d.expires_at!)}`
                    : `تنتهي ${shortDate(d.expires_at!)}`}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {staff ? (
        <Card className="mb-6 shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">إضافة وثيقة</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>العقار</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر العقار" />
                </SelectTrigger>
                <SelectContent>
                  {data.properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>نوع الوثيقة</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kinds.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>اسم الوثيقة</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="صك برج الملقا"
              />
            </div>
            <div className="space-y-2">
              <Label>رقم الوثيقة</Label>
              <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>تاريخ الانتهاء</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>الملف (PDF أو صورة)</Label>
              <Input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Button
                disabled={!propertyId || !title.trim() || saving}
                onClick={() => save.mutate()}
              >
                <Upload className="size-4" />
                {saving ? "جارٍ الحفظ…" : "حفظ الوثيقة"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">الأرشيف</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.docs.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-muted-foreground">
                  {kindLabel[d.kind] ?? d.kind} · {d.properties?.name ?? "—"}
                  {d.doc_number ? ` · رقم ${d.doc_number}` : ""}
                  {d.expires_at ? ` · تنتهي ${shortDate(d.expires_at)}` : ""}
                </p>
                {d.notes ? <p className="mt-1 text-xs text-muted-foreground">{d.notes}</p> : null}
              </div>
              {d.file_path ? (
                <Button size="sm" variant="outline" onClick={() => openFile(d.file_path!)}>
                  <FileText className="size-4" />
                  فتح الملف
                </Button>
              ) : null}
            </div>
          ))}
          {data.docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد وثائق محفوظة بعد.</p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
