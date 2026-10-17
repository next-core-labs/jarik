import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Copy,
  FileText,
  Handshake,
  Home,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Sofa,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { RequestAgreementDialog } from "@/components/request-agreement-dialog";
import {
  buildingSpecsLine,
  unitSpecsLine,
  UnitFurnishingLine,
} from "@/components/unit-specs-summary";
import { sar, unitStatusLabel } from "@/lib/format";
import { activeAgreementUnitIds, useOwnerUnitGroups } from "@/lib/owner-units";
import { useMyRoles } from "@/lib/use-role";

export const Route = createFileRoute("/_authenticated/owner/properties")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "عقاراتي — جارك" },
      {
        name: "description",
        content: "سجّل شقتك أو فيلتك أو عمارتك بمواصفاتها وأثاثها، واطلب من مكتب قريب إدارتها.",
      },
    ],
  }),
  component: OwnerProperties,
});

type Management =
  { kind: "active"; office: string } | { kind: "pending"; office: string } | { kind: "none" };

function OwnerProperties() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const userId = me?.userId ?? null;

  const [newProperty, setNewProperty] = useState(false);
  const [editingProperty, setEditingProperty] = useState<EditableProperty | null>(null);
  const [unitDialog, setUnitDialog] = useState<{
    propertyId: string;
    propertyName: string;
    values: UnitFormValues;
  } | null>(null);
  const [bulk, setBulk] = useState<{
    propertyId: string;
    propertyName: string;
    district: string | null;
    floorsCount: number | null;
    existingNumbers: string[];
  } | null>(null);
  const [requestFor, setRequestFor] = useState<string[] | null>(null);

  const own = useQuery({
    queryKey: ["owner-own-properties", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select(
          "id, name, property_type, structure, building_type, floors_count, year_built, elevators, parking_spaces, org_id, city, district, address, deed_number, owner_name, lat, lng, units(id, unit_number, unit_name, unit_type, district, street, floor_no, rooms, halls, bathrooms, area, annual_rent, sale_price, listing_purpose, status, furnishing, furniture, furniture_notes, deed_number, electricity_meter_no, water_meter_no, owner_id, notes, auto_price_decay, price_floor)",
        )
        .eq("owner_id", userId!)
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Who manages each unit: the owner's agreements (RLS: their own) and the offices' names.
  const agreements = useQuery({
    queryKey: ["owner-agreements-by-unit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("management_agreements")
        .select(
          "id, status, org_id, notice_period_days, termination_requested_at, agreement_units(unit_id)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const officeNames = useQuery({
    queryKey: ["owner-agreements-office-names"],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.rpc("my_agreement_offices");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) map[row.org_id] = row.company_name;
      return map;
    },
  });
  const groups = useOwnerUnitGroups();

  const activeUnits = useMemo(
    () => activeAgreementUnitIds(agreements.data ?? []),
    [agreements.data],
  );
  const managementOf = (unitId: string): Management => {
    const office = (orgId: string) => officeNames.data?.[orgId] ?? "مكتب";
    const list = agreements.data ?? [];
    const active = list.find(
      (a) =>
        a.status === "active" &&
        activeUnits.has(unitId) &&
        a.agreement_units.some((au) => au.unit_id === unitId),
    );
    if (active) return { kind: "active", office: office(active.org_id) };
    const pending = list.find(
      (a) =>
        (a.status === "sent" || a.status === "office_modified") &&
        a.agreement_units.some((au) => au.unit_id === unitId),
    );
    if (pending) return { kind: "pending", office: office(pending.org_id) };
    return { kind: "none" };
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["owner-own-properties"] });
    queryClient.invalidateQueries({ queryKey: ["owner-agreements-properties"] });
  };

  const deleteUnit = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("units").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("حُذفت الوحدة");
      refresh();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حذف الوحدة")),
  });
  const deleteProperty = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("properties").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("حُذف العقار ووحداته");
      refresh();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حذف العقار")),
  });

  const continueAfterCreate = (c: CreatedProperty) => {
    if (c.structure === "single") {
      setUnitDialog({
        propertyId: c.id,
        propertyName: c.name,
        values: {
          ...emptyUnit,
          unit_number: "1",
          unit_type: c.unit_type,
          district: c.district,
          deed_number: c.deed_number,
          market_listed: false,
        },
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

  const properties = own.data ?? [];
  const shownIds = new Set(properties.map((p) => p.id));
  // Units assigned to this owner inside an office's property (properties RLS hides that property).
  const elsewhere = (groups.data ?? []).filter((g) => !shownIds.has(g.id));
  const loading = own.isLoading || agreements.isLoading || groups.isLoading;

  return (
    <>
      <PageHeader
        title="عقاراتي"
        subtitle="سجّل شقتك أو فيلتك أو عمارتك بمواصفاتها الكاملة وأثاثها، ثم اطلب من مكتب قريب إدارتها."
        action={
          <Button onClick={() => setNewProperty(true)}>
            <Plus className="size-4" />
            إضافة عقار
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : own.error ? (
        <p className="text-destructive">
          {userErrorMessage(own.error, "تعذّر تحميل عقاراتك — حاول مرة أخرى")}
        </p>
      ) : properties.length === 0 && elsewhere.length === 0 ? (
        <Card className="shadow-deed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="grid size-12 place-items-center bg-sidebar text-sidebar-foreground">
              <Building2 className="size-6" />
            </span>
            <div>
              <p className="font-display text-lg font-bold">أضف أول عقار لك</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                سجّل بيانات الصك والمساحة والغرف والأثاث، ثم أرسل طلب إدارة لمكتب قريب — يصله إشعار
                فورًا ويقبل أو يعتذر.
              </p>
            </div>
            <Button onClick={() => setNewProperty(true)}>
              <Plus className="size-4" />
              إضافة عقار
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {properties.map((p) => {
            const editable = p.org_id == null;
            const units = [...(p.units ?? [])].sort((a, b) =>
              (a.unit_number ?? "").localeCompare(b.unit_number ?? "", "ar", { numeric: true }),
            );
            const single = p.structure === "single";
            const canAddUnits = editable && (!single || units.length === 0);
            const unmanaged = units.filter((u) => managementOf(u.id).kind === "none");
            const specs = buildingSpecsLine(p);
            return (
              <Card key={p.id} className="shadow-deed">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center bg-muted text-brass">
                        {single ? <Home className="size-5" /> : <Building2 className="size-5" />}
                      </span>
                      <div>
                        <CardTitle className="font-display text-xl">{p.name}</CardTitle>
                        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="size-3.5" />
                          {[p.city, p.district].filter(Boolean).join(" · ") || "بدون عنوان"} ·{" "}
                          {single
                            ? (units[0]?.unit_type ?? "وحدة مستقلة")
                            : (p.building_type ?? "عمارة")}
                        </p>
                        {specs || p.deed_number ? (
                          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {specs ? (
                              <span className="flex items-center gap-1">
                                <Layers className="size-3.5" />
                                {specs}
                              </span>
                            ) : null}
                            {p.deed_number ? (
                              <span className="flex items-center gap-1">
                                <FileText className="size-3.5" />
                                صك <span dir="ltr">{p.deed_number}</span>
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {single ? null : <Badge variant="outline">{units.length} وحدة</Badge>}
                      {editable ? null : <Badge variant="secondary">سجّله مكتبك</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {unmanaged.length > 0 ? (
                      <Button size="sm" onClick={() => setRequestFor(unmanaged.map((u) => u.id))}>
                        <Handshake className="size-4" />
                        اطلب إدارة من مكتب قريب
                      </Button>
                    ) : null}
                    {canAddUnits && !single ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setBulk({
                            propertyId: p.id,
                            propertyName: p.name,
                            district: p.district,
                            floorsCount: p.floors_count,
                            existingNumbers: units.map((u) => u.unit_number ?? ""),
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
                        variant="outline"
                        onClick={() =>
                          setUnitDialog({
                            propertyId: p.id,
                            propertyName: p.name,
                            values: {
                              ...emptyUnit,
                              district: p.district ?? "",
                              market_listed: false,
                              ...(single
                                ? { unit_number: "1", deed_number: p.deed_number ?? "" }
                                : {}),
                            },
                          })
                        }
                      >
                        <Plus className="size-4" />
                        {single ? "إضافة مواصفات الوحدة" : "إضافة وحدة"}
                      </Button>
                    ) : null}
                    {editable ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={deleteProperty.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `حذف «${p.name}» وكل وحداته (${units.length})؟ لا يمكن التراجع.`,
                              )
                            ) {
                              deleteProperty.mutate(p.id);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                          حذف
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent>
                  {units.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {single
                        ? "أكمل مواصفات الوحدة (المساحة، الغرف، الأثاث) لتتمكن من طلب الإدارة."
                        : "لا وحدات بعد — أضف شقق العمارة دفعة واحدة أو كل شقة بمواصفاتها."}
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {units.map((u) => {
                        const m = managementOf(u.id);
                        const specsLine = unitSpecsLine(u);
                        return (
                          <div
                            key={u.id}
                            className="rounded-md border border-border bg-background p-4"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-medium">
                                {single ? u.unit_type : `وحدة ${u.unit_number} · ${u.unit_type}`}
                                {u.unit_name ? ` · ${u.unit_name}` : ""}
                              </p>
                              <Badge variant={u.status === "vacant" ? "outline" : "secondary"}>
                                {unitStatusLabel[u.status] ?? u.status}
                              </Badge>
                            </div>
                            {specsLine ? (
                              <p className="mt-2 text-sm text-muted-foreground">{specsLine}</p>
                            ) : null}
                            <p className="mt-1 text-sm">
                              {u.listing_purpose === "sale"
                                ? `${sar(u.sale_price)} · للبيع`
                                : u.annual_rent
                                  ? `${sar(u.annual_rent)} سنويًا`
                                  : "الإيجار غير محدد"}
                            </p>
                            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
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
                                <Handshake className="size-3.5 text-brass" />
                                {m.kind === "active"
                                  ? `يديرها ${m.office}`
                                  : m.kind === "pending"
                                    ? `طلب إدارة بانتظار ردّ ${m.office}`
                                    : "بدون مكتب إدارة"}
                              </p>
                            </div>
                            {editable ? (
                              <div className="mt-3 flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1"
                                  onClick={() =>
                                    setUnitDialog({
                                      propertyId: p.id,
                                      propertyName: p.name,
                                      values: unitFormFromRow(u),
                                    })
                                  }
                                >
                                  <Pencil className="size-4" />
                                  تعديل المواصفات
                                </Button>
                                {!single ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      setUnitDialog({
                                        propertyId: p.id,
                                        propertyName: p.name,
                                        values: unitFormFromRow(u, true),
                                      })
                                    }
                                  >
                                    <Copy className="size-4" />
                                    نسخ
                                  </Button>
                                ) : null}
                                {m.kind === "none" ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    aria-label={`حذف الوحدة ${u.unit_number}`}
                                    disabled={deleteUnit.isPending}
                                    onClick={() => {
                                      if (window.confirm(`حذف الوحدة ${u.unit_number}؟`)) {
                                        deleteUnit.mutate(u.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {elsewhere.length > 0 ? (
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="text-base">وحدات سجّلها مكتب باسمك</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {elsewhere.map((g) => (
                  <p key={g.id}>
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted-foreground">
                      {" — "}
                      {(g.units ?? []).map((u) => `وحدة ${u.unit_number}`).join("، ")}
                    </span>
                  </p>
                ))}
                <Link to="/owner-dashboard" className="inline-block text-sm underline">
                  تفاصيلها في لوحة المالك
                </Link>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <PropertyDialog
        open={newProperty}
        onOpenChange={setNewProperty}
        mode="owner"
        onCreated={continueAfterCreate}
      />
      <PropertyDialog
        open={Boolean(editingProperty)}
        onOpenChange={(v) => {
          if (!v) setEditingProperty(null);
        }}
        property={editingProperty}
        mode="owner"
      />
      {unitDialog ? (
        <UnitDialog
          open
          onOpenChange={(v) => {
            if (!v) setUnitDialog(null);
          }}
          propertyId={unitDialog.propertyId}
          propertyName={unitDialog.propertyName}
          initial={unitDialog.values}
          canManage
          mode="owner"
        />
      ) : null}
      {bulk ? (
        <BulkUnitsDialog
          open
          onOpenChange={(v) => {
            if (!v) setBulk(null);
          }}
          {...bulk}
        />
      ) : null}
      {requestFor ? (
        <RequestAgreementDialog
          properties={groups.data ?? []}
          excludedUnitIds={activeUnits}
          initialUnitIds={requestFor}
          onClose={() => setRequestFor(null)}
          onDone={() => {
            setRequestFor(null);
            queryClient.invalidateQueries({ queryKey: ["owner-agreements-by-unit"] });
            queryClient.invalidateQueries({ queryKey: ["owner-agreements"] });
          }}
        />
      ) : null}
    </>
  );
}
