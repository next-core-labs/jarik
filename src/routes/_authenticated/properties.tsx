import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Globe,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  type UnitLocks,
} from "@/components/unit-dialog";
import { BulkUnitsDialog } from "@/components/bulk-units-dialog";
import { buildingSpecsLine, UnitFurnishingLine } from "@/components/unit-specs-summary";
import { sar, shortDate, unitStatusLabel } from "@/lib/format";
import { listClientAccounts } from "@/lib/admin-users.functions";
import { generateAdText } from "@/lib/pricing.functions";
import { confirmListingPayment } from "@/lib/listing-payments.functions";
import { listingPaymentIdFromSearch, marketState, officeListingBlock } from "@/lib/listing-fee";
import { useMyRoles } from "@/lib/use-role";
import { myOrgId } from "@/lib/use-org-branding";
import { useUnitManagement, type UnitManagement } from "@/lib/unit-management";

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

/**
 * What an office may change on an owner's unit it manages under an agreement (the database refuses
 * the rest: guard_unit_agreement_columns). The deed and furniture stay the owner's.
 */
function agreementLocks(m: UnitManagement): UnitLocks {
  return {
    rent: !m.pricing,
    advert: !m.leasing,
    details: !m.leasing,
    deed: true,
    note: m.leasing
      ? m.pricing
        ? "وحدة مالك باتفاقية إدارة — رقم الصك والأثاث يعدّلهما المالك فقط."
        : "وحدة مالك باتفاقية إدارة لا تشمل التسعير — الإيجار ورقم الصك والأثاث يعدّلها المالك."
      : "صلاحيتك في اتفاقية الإدارة تشمل التسعير فقط — تعدّل الإيجار وحده.",
  };
}

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
  // A staff account in no office can record nothing: every property belongs to an office, and the
  // database refuses one this account is not a member of (app-shell explains it in a banner).
  const myOffice = useQuery({
    queryKey: ["my-org-id", me?.userId],
    enabled: isStaff,
    staleTime: 60_000,
    queryFn: () => myOrgId(),
  });
  const noOffice = isStaff && myOffice.isSuccess && myOffice.data === null;
  // Paying to publish buys nothing until the office is listed and verified: say so on the unit
  // instead of offering the payment.
  const officeListing = useQuery({
    queryKey: ["office-listing-ready", myOffice.data],
    enabled: Boolean(myOffice.data),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_settings")
        .select("listed_publicly, verified")
        .eq("id", myOffice.data!)
        .maybeSingle();
      if (error) throw error;
      return data ? officeListingBlock(data) : null;
    },
  });

  const [dialog, setDialog] = useState<{
    propertyId: string;
    propertyName: string;
    values: UnitFormValues;
    leaseTenant: string | null;
    locks?: UnitLocks;
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
  // Buildings start folded: each one opens to its own units.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Adding units to a building (one, in bulk, or right after registering it) opens that building.
  const workingOn = dialog?.propertyId ?? bulk?.propertyId ?? null;
  useEffect(() => {
    if (!workingOn) return;
    setOpenIds((prev) => (prev.has(workingOn) ? prev : new Set(prev).add(workingOn)));
  }, [workingOn]);
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

  // Publishing on the website is free for offices: the database (guard_market_publish) records
  // the publication under this office when its staff switch the unit on.
  const publish = useMutation({
    mutationFn: async ({ unitId, listed }: { unitId: string; listed: boolean }) => {
      const { data, error } = await supabase
        .from("units")
        .update(
          listed
            ? { market_listed: true, market_listed_at: new Date().toISOString() }
            : { market_listed: false },
        )
        .eq("id", unitId)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("ليست لديك صلاحية نشر هذه الوحدة");
      return listed;
    },
    onSuccess: (listed) => {
      toast.success(listed ? "نُشرت الوحدة في الموقع" : "أُخفيت الوحدة من الموقع");
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث النشر")),
  });

  // Back from Moyasar: the server asks Moyasar whether it was paid; the URL itself proves nothing.
  const confirmPayment = useServerFn(confirmListingPayment);
  useEffect(() => {
    const paymentId = listingPaymentIdFromSearch(window.location.search);
    if (!paymentId) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    confirmPayment({ data: { paymentId } })
      .then((res) => {
        if (res.status === "paid") {
          toast.success(`تم الدفع ونُشرت الوحدة في الموقع حتى ${shortDate(res.paidUntil)}`);
        } else if (res.status === "pending") {
          toast.info(
            "لم يتأكد الدفع بعد. إن أتممته فاضغط «نشر في الموقع» على الوحدة مرة أخرى للتحقق.",
          );
        } else {
          toast.warning("أُلغيت عملية الدفع ولم تُنشر الوحدة.");
        }
        queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      })
      .catch((e: Error) => toast.error(userErrorMessage(e, "تعذّر التحقق من الدفع")));
  }, [confirmPayment, queryClient]);

  const { data: fetched, isLoading } = useQuery({
    queryKey: ["properties-with-units"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select(
          "id, name, property_type, structure, building_type, floors_count, year_built, elevators, parking_spaces, org_id, owner_id, city, district, address, deed_number, owner_name, lat, lng, units(id, unit_number, unit_name, unit_type, district, street, floor_no, rooms, halls, bathrooms, area, annual_rent, sale_price, listing_purpose, status, furnished, furnishing, furniture, furniture_notes, deed_number, electricity_meter_no, water_meter_no, owner_id, notes, auto_price_decay, price_floor, market_listed, market_paid_until, market_org_id, leases(status, tenants(full_name)))",
        )
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  // An account that is staff and also an owner gets its own office-less properties back from RLS;
  // those are managed from «عقاراتي» (/owner/properties), not here.
  const data = (fetched ?? []).filter(
    (p) => !(p.org_id == null && me?.userId && p.owner_id === me.userId),
  );
  type Unit = (typeof data)[number]["units"][number];
  // Owners' units seen through a management agreement: what the agreement lets this office edit.
  const management = useUnitManagement(
    data.filter((p) => p.org_id == null).flatMap((p) => (p.units ?? []).map((u) => u.id)),
  );
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
  const visible = data
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
          isStaff && !noOffice ? (
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
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">لا توجد عقارات بعد</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {noOffice
                ? "حسابك غير مرتبط بأي مكتب — اطلب من مدير مكتبك دعوتك من «فريق المكتب» لتسجّل عقاراته."
                : "سجّل أول عقار، ثم أضف وحداته الشاغرة لتظهر في سوق العروض."}
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
                placeholder="ابحث بالوحدة أو العقار أو المستأجر"
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
            const vacant = all.filter((u) => u.status === "vacant").length;
            // Open when chosen, while a search/filter shows matches, or when it is the only one.
            const isOpen = filtering || visible.length === 1 || openIds.has(p.id);
            // An owner's own property, seen here through an accepted management agreement: the
            // owner keeps its record and units; the office manages within the agreement.
            const ownerManaged = p.org_id == null;
            const canAddUnits = !ownerManaged && (p.structure !== "single" || all.length === 0);
            const specs = buildingSpecsLine(p);
            return (
              <Card key={p.id} className="shadow-deed">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="flex min-w-0 basis-full items-start gap-3 text-start sm:basis-0 sm:flex-1"
                      data-building-toggle
                      onClick={() => toggleOpen(p.id)}
                      aria-expanded={isOpen}
                      disabled={filtering || visible.length === 1}
                    >
                      <ChevronDown
                        className={cn(
                          "mt-1.5 size-5 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-180",
                          (filtering || visible.length === 1) && "hidden",
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0">
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
                        {!isOpen ? (
                          <p className="mt-2 text-sm font-medium underline underline-offset-4">
                            عرض الوحدات ({all.length})
                          </p>
                        ) : null}
                      </div>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      {ownerManaged ? (
                        <Badge variant="secondary" className="gap-1">
                          <Handshake className="size-3.5" />
                          عقار مالك — باتفاقية إدارة
                        </Badge>
                      ) : null}
                      <Badge variant="outline">{all.length} وحدة</Badge>
                      <Badge>{occupied} مشغولة</Badge>
                      <Badge variant="secondary">{vacant} شاغرة</Badge>
                      {isStaff && !ownerManaged && isOpen ? (
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
                                unitsCount: all.length,
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
                {isOpen ? (
                  <CardContent>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {units.map((u) => {
                        const rights = ownerManaged ? management.data?.get(u.id) : undefined;
                        // An owner's unit opens for editing only when the agreement grants pricing or
                        // leasing; with view/maintenance alone every save would be refused.
                        const canEdit =
                          !ownerManaged || Boolean(rights?.pricing || rights?.leasing);
                        const canPublish = !ownerManaged || Boolean(rights?.leasing);
                        return (
                          <div
                            key={u.id}
                            className="rounded-md border border-border bg-background p-4"
                          >
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
                                عداد الكهرباء:{" "}
                                <span dir="ltr">{u.electricity_meter_no ?? "—"}</span>
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
                                <UnitMarketStatus
                                  unit={u}
                                  officeId={myOffice.data ?? null}
                                  canPublish={canPublish}
                                  publishBlock={officeListing.data ?? null}
                                  publishing={
                                    publish.isPending && publish.variables?.unitId === u.id
                                  }
                                  onToggle={(listed) => publish.mutate({ unitId: u.id, listed })}
                                />
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
                                        .filter(
                                          (c) => c.roles.includes("owner") || c.id === u.owner_id,
                                        )
                                        .map((c) => (
                                          <SelectItem key={c.id} value={c.id}>
                                            {c.fullName || c.email}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                )}
                                {canEdit ? (
                                  <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() =>
                                      setDialog({
                                        propertyId: p.id,
                                        propertyName: p.name,
                                        values: unitFormFromRow(u),
                                        leaseTenant: leaseTenant(u),
                                        ...(rights ? { locks: agreementLocks(rights) } : {}),
                                      })
                                    }
                                  >
                                    <Pencil className="size-4" />
                                    {ownerManaged ? "تعديل" : "تعديل وفواتير الإصلاح"}
                                  </Button>
                                ) : null}
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
                        );
                      })}
                      {units.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {all.length === 0
                            ? "لا توجد وحدات مسجّلة."
                            : "لا توجد وحدات تطابق البحث."}
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
          {data.length === 0 ? (
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
          {...(dialog.locks ? { locks: dialog.locks } : {})}
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

/** Whether the unit is on the website, with the (free) publish / hide button. */
function UnitMarketStatus({
  unit,
  officeId,
  canPublish,
  publishBlock,
  publishing,
  onToggle,
}: {
  unit: {
    status: string;
    market_listed: boolean;
    market_paid_until: string | null;
    market_org_id: string | null;
  };
  /** The viewing office: another office's publication is not this office's. */
  officeId: string | null;
  /** An owner's unit is published only by an office whose agreement grants leasing. */
  canPublish: boolean;
  /** Why the office's units don't show yet (not listed / not verified), or null. */
  publishBlock: string | null;
  publishing: boolean;
  onToggle: (listed: boolean) => void;
}) {
  const market = marketState(unit, undefined, officeId);
  const listed = unit.market_listed && (market.kind === "free" || market.kind === "paid");
  // An occupied unit never shows on the website: nothing to publish until it is vacant again.
  const canToggle = canPublish && (listed || unit.status === "vacant");
  return (
    <>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Globe className="size-3.5 text-brass" />
        {listed
          ? unit.status === "vacant"
            ? "منشورة في الموقع"
            : "منشورة — تظهر في الموقع متى أصبحت شاغرة"
          : "غير منشورة في الموقع"}
      </p>
      {canToggle && publishBlock ? (
        <p className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {publishBlock}{" "}
          <Link to="/settings" className="font-medium text-foreground underline underline-offset-4">
            الإعدادات
          </Link>
        </p>
      ) : null}
      {canToggle ? (
        <Button
          variant={listed ? "outline" : "default"}
          className="w-full"
          disabled={publishing}
          onClick={() => onToggle(!listed)}
        >
          <Globe className="size-4" />
          {publishing ? "جارٍ الحفظ…" : listed ? "إخفاء من الموقع" : "نشر في الموقع — مجانًا"}
        </Button>
      ) : null}
    </>
  );
}
