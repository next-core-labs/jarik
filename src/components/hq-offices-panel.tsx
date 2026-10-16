import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BadgeCheck, MessageSquare, Search, ShieldOff, Star } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { shortDate } from "@/lib/format";

/**
 * نسخة من `admin-offices-panel.tsx` تستدعي دوال hq_* بدل admin_* (حارس صلاحية "offices" بـ/hq
 * بدل دور admin بـ/admin) — نفس نمط ازدواج hqImpersonateStart/impersonateStart المتَّبع أصلًا
 * بهذا الكود، لا تعديل على لوحة /admin الأصلية.
 */
export function HqOfficesPanel() {
  const queryClient = useQueryClient();
  const [pendingOnly, setPendingOnly] = useState(false);

  const offices = useQuery({
    queryKey: ["hq-offices"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("hq_list_offices");
      if (error) throw error;
      return data ?? [];
    },
  });

  const setVerified = useMutation({
    mutationFn: async (input: { id: string; verified: boolean }) => {
      const { error } = await supabase.rpc("hq_set_office_verified", {
        _org: input.id,
        _verified: input.verified,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: async (input) => {
      toast.success(input.verified ? "تم توثيق المكتب — عروضه تظهر للجمهور" : "أُلغي توثيق المكتب");
      await queryClient.invalidateQueries({ queryKey: ["hq-offices"] });
      await queryClient.invalidateQueries({ queryKey: ["market"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث حالة المكتب")),
  });

  const setWhatsapp = useMutation({
    mutationFn: async (input: { id: string; locked: boolean }) => {
      const { error } = await supabase.rpc("hq_set_office_flags", {
        _org: input.id,
        _whatsapp_locked: input.locked,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: async (input) => {
      toast.success(input.locked ? "أُقفل واتساب المكتب" : "فُتح واتساب المكتب");
      await queryClient.invalidateQueries({ queryKey: ["hq-offices"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث قفل واتساب")),
  });

  const all = offices.data ?? [];
  const pending = all.filter((o) => !o.verified);
  const rows = pendingOnly ? pending : all;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {all.length} مكتب مسجّل · {pending.length} بانتظار التوثيق
          </p>
          <Button size="sm" variant="outline" onClick={() => setPendingOnly((v) => !v)}>
            {pendingOnly ? "عرض كل المكاتب" : "بانتظار التوثيق فقط"}
          </Button>
        </div>

        {offices.isLoading ? (
          <Skeleton className="h-48" />
        ) : offices.error ? (
          <p className="text-sm text-destructive">تعذّر تحميل المكاتب.</p>
        ) : (
          rows.map((o) => (
            <Card key={o.id} className="shadow-deed">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{o.company_name || "مكتب بلا اسم"}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[o.city, o.district].filter(Boolean).join(" — ") || "بلا عنوان"} · سُجّل{" "}
                      {shortDate(o.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={o.verified ? "default" : "outline"}>
                      {o.verified ? "موثَّق" : "غير موثَّق"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setWhatsapp.isPending}
                      onClick={() => setWhatsapp.mutate({ id: o.id, locked: !o.whatsapp_locked })}
                    >
                      <MessageSquare className="size-4" />
                      {o.whatsapp_locked ? "فتح واتساب" : "قفل واتساب"}
                    </Button>
                    {o.verified ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setVerified.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              "إلغاء التوثيق يُخفي عروض المكتب وصفحته عن الجمهور. متابعة؟",
                            )
                          ) {
                            setVerified.mutate({ id: o.id, verified: false });
                          }
                        }}
                      >
                        <ShieldOff className="size-4" />
                        إلغاء التوثيق
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={setVerified.isPending}
                        onClick={() => setVerified.mutate({ id: o.id, verified: true })}
                      >
                        <BadgeCheck className="size-4" />
                        توثيق المكتب
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">
                  رخصة فال: <span dir="ltr">{o.fal_license_no || "—"}</span>
                </Badge>
                <Badge variant="secondary">
                  جوال: <span dir="ltr">{o.office_phone || "—"}</span>
                </Badge>
                <Badge variant="secondary">
                  المدير: <span dir="ltr">{o.manager_email || "—"}</span>
                </Badge>
                <Badge variant="secondary">{o.members} عضو</Badge>
                <Badge variant="secondary">{o.properties} عقار</Badge>
                <Badge variant="secondary">{o.units} وحدة</Badge>
                {o.listed_publicly ? null : <Badge variant="secondary">غير معروض للجمهور</Badge>}
                {o.whatsapp_locked ? <Badge variant="secondary">واتساب مقفل</Badge> : null}
              </CardContent>
            </Card>
          ))
        )}
        {!offices.isLoading && !offices.error && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pendingOnly ? "لا مكاتب بانتظار التوثيق." : "لا مكاتب مسجّلة."}
          </p>
        ) : null}
      </div>

      <FeaturedListingsSection />
    </div>
  );
}

type FeaturedSearchRow = {
  id: string;
  unit_number: string | null;
  unit_name: string | null;
  district: string | null;
  featured: boolean | null;
  company_name: string | null;
};

/** تمييز/إلغاء تمييز عرض بالسوق العام — بحث بالاسم/الرقم/الحي ثم زر تبديل. */
function FeaturedListingsSection() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const results = useQuery({
    queryKey: ["hq-featured-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async () => {
      const q = search.trim();
      const { data, error } = await supabase
        .from("vacant_units_public")
        .select("id, unit_number, unit_name, district, featured, company_name")
        .or(`unit_number.ilike.%${q}%,unit_name.ilike.%${q}%,district.ilike.%${q}%`)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as FeaturedSearchRow[];
    },
  });

  const toggle = useMutation({
    mutationFn: async (input: { id: string; featured: boolean }) => {
      const { error } = await supabase.rpc("hq_set_unit_featured", {
        _unit: input.id,
        _featured: input.featured,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: async (input) => {
      toast.success(input.featured ? "صار العرض مميَّزًا" : "أُلغي تمييز العرض");
      await queryClient.invalidateQueries({ queryKey: ["hq-featured-search"] });
      await queryClient.invalidateQueries({ queryKey: ["market"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث التمييز")),
  });

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">تمييز العروض بالسوق العام</CardTitle>
        <p className="text-xs text-muted-foreground">
          العروض المميَّزة تظهر أولًا بالفرز الافتراضي ("الأحدث") بالصفحة الرئيسية.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative max-w-sm">
          <Search className="absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground start-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث برقم الوحدة أو اسمها أو الحي…"
            className="ps-9"
          />
        </div>

        {search.trim().length < 2 ? null : results.isLoading ? (
          <Skeleton className="h-24" />
        ) : results.error ? (
          <p className="text-sm text-destructive">تعذّر البحث.</p>
        ) : (results.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">لا عروض مطابقة.</p>
        ) : (
          <div className="space-y-2">
            {results.data!.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  {u.unit_name || `وحدة ${u.unit_number ?? ""}`}
                  <span className="text-muted-foreground">
                    {" "}
                    · {u.district ?? "—"} · {u.company_name ?? "—"}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: u.id, featured: !u.featured })}
                >
                  <Star className={cn("size-4", u.featured ? "fill-brass text-brass" : "")} />
                  {u.featured ? "إلغاء التمييز" : "تمييز العرض"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
