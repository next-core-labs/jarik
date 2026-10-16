import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Zap,
  Droplets,
  MapPin,
  UserCheck,
  Plus,
  Pencil,
  Sofa,
  Megaphone,
  Copy,
  Link2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropertyDialog } from "@/components/property-dialog";
import { UnitDialog, emptyUnit, type UnitFormValues } from "@/components/unit-dialog";
import { sar, unitStatusLabel } from "@/lib/format";
import { listClientAccounts } from "@/lib/admin-users.functions";
import { generateAdText } from "@/lib/pricing.functions";
import { useMyRoles } from "@/lib/use-role";

export const Route = createFileRoute("/_authenticated/properties")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "الأملاك والوحدات — جارك" },
      {
        name: "description",
        content: "العقارات ووحداتها مع حالة الإشغال وأرقام عدادات الكهرباء والمياه.",
      },
      { property: "og:title", content: "الأملاك والوحدات — جارك" },
      { property: "og:description", content: "إدارة العقارات والوحدات والعدادات." },
    ],
  }),
  component: Properties,
});

function Properties() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const isStaff = (me?.roles ?? []).some((r) => r === "admin" || r === "staff");

  const [dialog, setDialog] = useState<{
    propertyId: string;
    propertyName: string;
    values: UnitFormValues;
  } | null>(null);
  const [newProperty, setNewProperty] = useState(false);

  const [ad, setAd] = useState<{ unitId: string; label: string } | null>(null);
  const fetchAd = useServerFn(generateAdText);
  const adMut = useMutation({
    mutationFn: async (unitId: string) => {
      const res = await fetchAd({ data: { unitId } });
      return res.text;
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر توليد الإعلان"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["properties-with-units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select(
          "id, name, property_type, city, district, owner_name, units(id, unit_number, unit_name, unit_type, district, street, floor_no, rooms, halls, bathrooms, area, annual_rent, sale_price, listing_purpose, status, furnished, electricity_meter_no, water_meter_no, owner_id, tenant_id, notes, auto_price_decay, price_floor)",
        )
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const tenantsList = useQuery({
    queryKey: ["tenants-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, full_name, phone")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const tenantName = (id: string | null) =>
    id ? ((tenantsList.data ?? []).find((t) => t.id === id)?.full_name ?? "مستأجر") : null;

  const fetchClients = useServerFn(listClientAccounts);
  const clients = useQuery({
    queryKey: ["client-accounts"],
    queryFn: () => fetchClients(),
    enabled: isStaff,
  });

  const assignOwner = useMutation({
    mutationFn: async ({ unitId, ownerId }: { unitId: string; ownerId: string | null }) => {
      const { error } = await supabase.from("units").update({ owner_id: ownerId }).eq("id", unitId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إسناد الوحدة للعميل");
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
    },
    onError: () => toast.error("تعذّر الإسناد"),
  });

  const clientName = (id: string | null) => {
    if (!id) return null;
    const c = (clients.data ?? []).find((x) => x.id === id);
    return c ? c.fullName || c.email : "عميل";
  };

  return (
    <>
      <PageHeader
        title="الأملاك والوحدات"
        subtitle="كل عقار ووحداته، حالة الإشغال، ورقم عداد الكهرباء والمياه لكل وحدة."
        action={
          isStaff ? (
            <Button onClick={() => setNewProperty(true)}>
              <Plus className="size-4" />
              تسجيل عقار
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : (data ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">لا توجد عقارات بعد</p>
            <p className="mt-1 text-sm text-muted-foreground">
              سجّل أول عقار، ثم أضف وحداته الشاغرة لتظهر في سوق العروض.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {(data ?? []).map((p) => {
            const units = p.units ?? [];
            const occupied = units.filter((u) => u.status === "occupied").length;
            return (
              <Card key={p.id} className="shadow-deed">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="font-display text-xl">{p.name}</CardTitle>
                      <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="size-3.5" />
                        {p.city} {p.district ? `· ${p.district}` : ""} · {p.property_type}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{units.length} وحدة</Badge>
                      <Badge>{occupied} مشغولة</Badge>
                      {isStaff ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            setDialog({
                              propertyId: p.id,
                              propertyName: p.name,
                              values: { ...emptyUnit, district: p.district ?? "" },
                            })
                          }
                        >
                          <Plus className="size-4" />
                          تسجيل وحدة
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {units.map((u) => (
                      <div key={u.id} className="rounded-md border border-border bg-background p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium">
                            وحدة {u.unit_number}
                            {u.unit_name ? ` · ${u.unit_name}` : ""} · {u.unit_type}
                          </p>
                          {/* "default" (red) marks vacant/available only — occupied is neither the
                              price, the primary action, nor "available". */}
                          <Badge variant={u.status === "vacant" ? "default" : "secondary"}>
                            {unitStatusLabel[u.status] ?? u.status}
                          </Badge>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {u.rooms != null ? `${u.rooms} غرف · ` : ""}
                          {u.halls != null ? `${u.halls} صالة · ` : ""}
                          {u.bathrooms != null ? `${u.bathrooms} حمام · ` : ""}
                          {u.area != null ? `${u.area} م² · ` : ""}
                          {u.listing_purpose === "sale"
                            ? `${sar(u.sale_price)} · للبيع`
                            : `${sar(u.annual_rent)} سنويًا`}
                        </p>
                        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                          {u.district || u.street || u.floor_no ? (
                            <p className="flex items-center gap-1.5">
                              <MapPin className="size-3.5 text-brass" />
                              {[u.district, u.street, u.floor_no ? `الدور ${u.floor_no}` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                          <p className="flex items-center gap-1.5">
                            <Sofa className="size-3.5 text-brass" />
                            {u.furnished ? "مؤثثة" : "غير مؤثثة"}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <Zap className="size-3.5 text-brass" />
                            عداد الكهرباء: <span dir="ltr">{u.electricity_meter_no ?? "—"}</span>
                          </p>
                          <p className="flex items-center gap-1.5">
                            <Droplets className="size-3.5 text-brass" />
                            عداد المياه: <span dir="ltr">{u.water_meter_no ?? "—"}</span>
                          </p>
                          <p className="flex items-center gap-1.5">
                            <UserCheck className="size-3.5 text-brass" />
                            المالك: {clientName(u.owner_id) ?? "غير مسند"}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <UserCheck className="size-3.5 text-brass" />
                            المستأجر: {tenantName(u.tenant_id) ?? "بدون مستأجر"}
                          </p>
                        </div>
                        {isStaff ? (
                          <div className="mt-3 space-y-2">
                            {u.status === "vacant" ? (
                              <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                  setAd({
                                    unitId: u.id,
                                    label: `${u.unit_type} رقم ${u.unit_number}`,
                                  });
                                  adMut.mutate(u.id);
                                }}
                              >
                                <Megaphone className="size-4" />
                                إعلان جاهز
                              </Button>
                            ) : null}
                            <Select
                              value={u.owner_id ?? "none"}
                              onValueChange={(v) =>
                                assignOwner.mutate({
                                  unitId: u.id,
                                  ownerId: v === "none" ? null : v,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="إسناد الوحدة لمالك" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">بدون مالك</SelectItem>
                                {(clients.data ?? []).map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.fullName || c.email}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() =>
                                setDialog({
                                  propertyId: p.id,
                                  propertyName: p.name,
                                  values: {
                                    id: u.id,
                                    unit_number: u.unit_number ?? "",
                                    unit_name: u.unit_name ?? "",
                                    unit_type: u.unit_type ?? "شقة",
                                    district: u.district ?? "",
                                    street: u.street ?? "",
                                    floor_no: u.floor_no ?? "",
                                    rooms: u.rooms == null ? "" : String(u.rooms),
                                    halls: String(u.halls ?? 0),
                                    bathrooms: String(u.bathrooms ?? 0),
                                    area: u.area == null ? "" : String(u.area),
                                    annual_rent: String(u.annual_rent ?? 0),
                                    sale_price: String(u.sale_price ?? 0),
                                    listing_purpose: u.listing_purpose === "sale" ? "sale" : "rent",
                                    auto_price_decay: Boolean(u.auto_price_decay),
                                    price_floor: u.price_floor == null ? "" : String(u.price_floor),
                                    status: u.status ?? "vacant",
                                    electricity_meter_no: u.electricity_meter_no ?? "",
                                    water_meter_no: u.water_meter_no ?? "",
                                    furnished: Boolean(u.furnished),
                                    owner_id: u.owner_id ?? "none",
                                    tenant_id: u.tenant_id ?? "none",
                                    notes: u.notes ?? "",
                                    // Loaded by the dialog itself (see UnitDialog), so this screen
                                    // does not depend on the listing columns.
                                    listing_description: "",
                                    amenities: [],
                                    market_listed: false,
                                  },
                                })
                              }
                            >
                              <Pencil className="size-4" />
                              تعديل وفواتير الإصلاح
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {units.length === 0 ? (
                      <p className="text-sm text-muted-foreground">لا توجد وحدات مسجّلة.</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد عقارات مرتبطة بحسابك.</p>
          ) : null}
        </div>
      )}

      <PropertyDialog open={newProperty} onOpenChange={setNewProperty} />

      {dialog ? (
        <UnitDialog
          open
          onOpenChange={(v) => {
            if (!v) setDialog(null);
          }}
          propertyId={dialog.propertyId}
          propertyName={dialog.propertyName}
          initial={dialog.values}
          canManage={isStaff}
        />
      ) : null}

      {ad ? (
        <Dialog open onOpenChange={(v) => !v && setAd(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display">إعلان جاهز — {ad.label}</DialogTitle>
              <DialogDescription>
                انسخ الإعلان وشاركه في واتساب، أو أرسل رابط صفحة العرض.
              </DialogDescription>
            </DialogHeader>
            <Textarea rows={8} readOnly value={adMut.data ?? "جارٍ كتابة الإعلان..."} />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(adMut.data ?? "");
                  toast.success("تم نسخ الإعلان");
                }}
                disabled={!adMut.data}
              >
                <Copy className="size-4" />
                نسخ الإعلان
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(`${window.location.origin}/unit/${ad.unitId}`);
                  toast.success("تم نسخ رابط صفحة العرض");
                }}
              >
                <Link2 className="size-4" />
                نسخ رابط صفحة العرض
              </Button>
              {adMut.data ? (
                <Button asChild>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `${adMut.data}\n\n${window.location.origin}/unit/${ad.unitId}`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    مشاركة في واتساب
                  </a>
                </Button>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
