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
  Search,
  Layers,
  FileText,
  Handshake,
} from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  PropertyDialog,
  type CreatedProperty,
  type EditableProperty,
} from "@/components/property-dialog";
import {
  UnitDialog,
  emptyUnit,
  unitFormFromRow,
  type UnitFormValues,
} from "@/components/unit-dialog";
import { BulkUnitsDialog } from "@/components/bulk-units-dialog";
import { buildingSpecsLine, UnitFurnishingLine } from "@/components/unit-specs-summary";
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

/** 101, 102 … 110 — numeric-aware, so a building reads floor by floor. */
function sortUnits<T extends { unit_number: string | null }>(units: T[]): T[] {
  return [...units].sort((a, b) =>
    (a.unit_number ?? "").localeCompare(b.unit_number ?? "", "ar", { numeric: true }),
  );
}

function Properties() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const isStaff = (me?.roles ?? []).some((r) => r === "admin" || r === "staff");

  const [dialog, setDialog] = useState<{
    propertyId: string;
    propertyName: string;
    values: UnitFormValues;
    leaseTenant: string | null;
  } | null>(null);
  const [newProperty, setNewProperty] = useState(false);
  const [bulk, setBulk] = useState<{
    propertyId: string;
    propertyName: string;
    district: string | null;
    floorsCount: number | null;
    existingNumbers: string[];
  } | null>(null);
  const [editingProperty, setEditingProperty] = useState<EditableProperty | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [ad, setAd] = useState<{ unitId: string; label: string } | null>(null);
  const fetchAd = useServerFn(generateAdText);
  const adMut = useMutation({
    mutationFn: async (unitId: string) => {
      const res = await fetchAd({ data: { unitId } });
      return res.text;
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر توليد الإعلان")),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["properties-with-units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select(
          "id, name, property_type, structure, building_type, floors_count, year_built, elevators, parking_spaces, org_id, city, district, address, deed_number, owner_name, lat, lng, units(id, unit_number, unit_name, unit_type, district, street, floor_no, rooms, halls, bathrooms, area, annual_rent, sale_price, listing_purpose, status, furnished, furnishing, furniture, furniture_notes, deed_number, electricity_meter_no, water_meter_no, owner_id, notes, auto_price_decay, price_floor, leases(status, tenants(full_name)))",
        )
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  type Unit = NonNullable<typeof data>[number]["units"][number];
  // The tenant is whoever holds the unit's active lease — the same lease that makes it "مشغولة".
  const leaseTenant = (u: Unit) =>
    (u.leases ?? []).find((l) => l.status === "active")?.tenants?.full_name ?? null;

  const query = search.trim().toLowerCase();
  const unitMatches = (u: Unit) =>
    (statusFilter === "all" || u.status === statusFilter) &&
    (!query ||
      [u.unit_number, u.unit_name, u.unit_type, u.district, u.street, leaseTenant(u)].some((v) =>
        (v ?? "").toLowerCase().includes(query),
      ));
  const filtering = Boolean(query) || statusFilter !== "all";
  const visible = (data ?? [])
    .map((p) => {
      const propertyHit =
        Boolean(query) &&
        [p.name, p.city, p.district].some((v) => (v ?? "").toLowerCase().includes(query));
      // A search that names the building keeps all of its units (still narrowed by status).
      const units = sortUnits(p.units ?? []).filter((u) =>
        propertyHit ? statusFilter === "all" || u.status === statusFilter : unitMatches(u),
      );
      return { p, units, show: !filtering || units.length > 0 || propertyHit };
    })
    .filter((x) => x.show);

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

  // A new standalone unit goes straight to its unit form; a new building to adding its units.
  const continueAfterCreate = (c: CreatedProperty) => {
    if (c.structure === "single") {
      setDialog({
        propertyId: c.id,
        propertyName: c.name,
        values: {
          ...emptyUnit,
          unit_number: "1",
          unit_type: c.unit_type,
          district: c.district,
          deed_number: c.deed_number,
        },
        leaseTenant: null,
      });
    } else {
      setBulk({
        propertyId: c.id,
        propertyName: c.name,
        district: c.district || null,
        floorsCount: c.floors_count,
        existingNumbers: [],
      });
    }
  };

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
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث برقم الوحدة أو العقار أو المستأجر"
                className="ps-9"
                aria-label="بحث في الوحدات"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" aria-label="حالة الوحدة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الوحدات</SelectItem>
                <SelectItem value="occupied">{unitStatusLabel["occupied"]}</SelectItem>
                <SelectItem value="vacant">{unitStatusLabel["vacant"]}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filtering && visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد وحدات تطابق البحث.</p>
          ) : null}
          {visible.map(({ p, units }) => {
            const all = p.units ?? [];
            const occupied = all.filter((u) => u.status === "occupied").length;
            // An owner's own property, seen here through an accepted management agreement: the
            // owner keeps its record and units; the office manages within the agreement.
            const ownerManaged = p.org_id == null;
            const canAddUnits = !ownerManaged && (p.structure !== "single" || all.length === 0);
            const specs = buildingSpecsLine(p);
            return (
              <Card key={p.id} className="shadow-deed">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="font-display text-xl">{p.name}</CardTitle>
                      <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="size-3.5" />
                        {p.city} {p.district ? `· ${p.district}` : ""} ·{" "}
                        {p.structure === "single"
                          ? p.property_type
                          : (p.building_type ?? p.property_type)}
                      </p>
                      {specs ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <Layers className="size-3.5" />
                          {specs}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {ownerManaged ? (
                        <Badge variant="secondary" className="gap-1">
                          <Handshake className="size-3.5" />
                          عقار مالك — باتفاقية إدارة
                        </Badge>
                      ) : null}
                      <Badge variant="outline">{all.length} وحدة</Badge>
                      <Badge>{occupied} مشغولة</Badge>
                      {isStaff && !ownerManaged ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setEditingProperty({
                                id: p.id,
                                name: p.name,
                                property_type: p.property_type,
                                structure: p.structure,
                                building_type: p.building_type,
                                city: p.city,
                                district: p.district,
                                address: p.address,
                                deed_number: p.deed_number,
                                owner_name: p.owner_name,
                                lat: p.lat,
                                lng: p.lng,
                                floors_count: p.floors_count,
                                year_built: p.year_built,
                                elevators: p.elevators,
                                parking_spaces: p.parking_spaces,
                              })
                            }
                          >
                            <Pencil className="size-4" />
                            تعديل العقار
                          </Button>
                          {canAddUnits && p.structure !== "single" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setBulk({
                                  propertyId: p.id,
                                  propertyName: p.name,
                                  district: p.district,
                                  floorsCount: p.floors_count,
                                  existingNumbers: all.map((u) => u.unit_number ?? ""),
                                })
                              }
                            >
                              <Layers className="size-4" />
                              إضافة وحدات دفعة واحدة
                            </Button>
                          ) : null}
                          {canAddUnits ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                setDialog({
                                  propertyId: p.id,
                                  propertyName: p.name,
                                  values: {
                                    ...emptyUnit,
                                    district: p.district ?? "",
                                    ...(p.structure === "single"
                                      ? { unit_number: "1", deed_number: p.deed_number ?? "" }
                                      : {}),
                                  },
                                  leaseTenant: null,
                                })
                              }
                            >
                              <Plus className="size-4" />
                              تسجيل وحدة
                            </Button>
                          ) : null}
                        </>
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
                          <UnitFurnishingLine
                            furnishing={u.furnishing}
                            furniture={u.furniture}
                            icon={<Sofa className="size-3.5 shrink-0 text-brass" />}
                          />
                          {u.deed_number ? (
                            <p className="flex items-center gap-1.5">
                              <FileText className="size-3.5 text-brass" />
                              صك الوحدة: <span dir="ltr">{u.deed_number}</span>
                            </p>
                          ) : null}
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
                            المالك:{" "}
                            {ownerManaged
                              ? (p.owner_name ?? "المالك المتعاقد")
                              : (clientName(u.owner_id) ?? "غير مسند")}
                          </p>
                          <p className="flex items-center gap-1.5">
                            <UserCheck className="size-3.5 text-brass" />
                            المستأجر: {leaseTenant(u) ?? "بدون مستأجر"}
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
                            {ownerManaged ? null : (
                              <Select
                                value={u.owner_id ?? "none"}
                                onValueChange={(v) =>
                                  assignOwner.mutate({
                                    unitId: u.id,
                                    ownerId: v === "none" ? null : v,
                                  })
                                }
                              >
                                <SelectTrigger aria-label="إسناد الوحدة لمالك">
                                  <SelectValue placeholder="إسناد الوحدة لمالك" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">بدون مالك</SelectItem>
                                  {/* Owner accounts only (not staff, tenants or technicians); a unit
                                    already assigned to someone else keeps that option visible. */}
                                  {(clients.data ?? [])
                                    .filter((c) => c.roles.includes("owner") || c.id === u.owner_id)
                                    .map((c) => (
                                      <SelectItem key={c.id} value={c.id}>
                                        {c.fullName || c.email}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            )}
                            <Button
                              variant="outline"
                              className="w-full"
                              onClick={() =>
                                setDialog({
                                  propertyId: p.id,
                                  propertyName: p.name,
                                  values: unitFormFromRow(u),
                                  leaseTenant: leaseTenant(u),
                                })
                              }
                            >
                              <Pencil className="size-4" />
                              تعديل وفواتير الإصلاح
                            </Button>
                            {canAddUnits ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                onClick={() =>
                                  setDialog({
                                    propertyId: p.id,
                                    propertyName: p.name,
                                    values: unitFormFromRow(u, true),
                                    leaseTenant: null,
                                  })
                                }
                              >
                                <Copy className="size-4" />
                                نسخ كوحدة جديدة
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {units.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {all.length === 0 ? "لا توجد وحدات مسجّلة." : "لا توجد وحدات تطابق البحث."}
                      </p>
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

      <PropertyDialog
        open={newProperty}
        onOpenChange={setNewProperty}
        onCreated={continueAfterCreate}
      />
      {bulk ? (
        <BulkUnitsDialog
          open
          onOpenChange={(v) => {
            if (!v) setBulk(null);
          }}
          {...bulk}
        />
      ) : null}
      <PropertyDialog
        open={Boolean(editingProperty)}
        onOpenChange={(v) => {
          if (!v) setEditingProperty(null);
        }}
        property={editingProperty}
      />

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
          leaseTenant={dialog.leaseTenant}
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
