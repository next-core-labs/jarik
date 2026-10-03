import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { FileSpreadsheet, Link2, RefreshCw, Save, Upload } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayRiyadh } from "@/lib/dates";
import { shortDate, leaseStatusLabel } from "@/lib/format";
import { myOrgId } from "@/lib/use-org-branding";
import { getEjarConnectionStatus, syncEjar } from "@/lib/ejar.functions";

export const Route = createFileRoute("/_authenticated/ejar")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "ربط إيجار والعدادات — جارك" },
      {
        name: "description",
        content:
          "ربط عقود «إيجار» بأرقامها الرسمية وتسجيل قراءات الكهرباء والمياه يدويًا أو باستيراد ملف Excel.",
      },
      { property: "og:title", content: "ربط إيجار والعدادات — جارك" },
      { property: "og:description", content: "أرقام عقود إيجار وقراءات العدادات في مكان واحد." },
    ],
  }),
  component: EjarPage,
});

function EjarPage() {
  return (
    <>
      <PageHeader
        title="ربط «إيجار» والعدادات"
        subtitle="أرقام العقود الرسمية وقراءات الكهرباء والمياه — إدخال مباشر أو استيراد ملف Excel."
      />
      <Tabs defaultValue="ejar">
        <TabsList>
          <TabsTrigger value="ejar">عقود إيجار</TabsTrigger>
          <TabsTrigger value="meters">قراءات العدادات</TabsTrigger>
        </TabsList>
        <TabsContent value="ejar" className="mt-4">
          <EjarSection />
        </TabsContent>
        <TabsContent value="meters" className="mt-4">
          <MetersSection />
        </TabsContent>
      </Tabs>
    </>
  );
}

function EjarSection() {
  const queryClient = useQueryClient();
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [contracts, setContracts] = useState<Record<string, string>>({});

  const org = useQuery({
    queryKey: ["org-ejar"],
    queryFn: async () => {
      const mine = await myOrgId();
      const query = supabase
        .from("org_settings")
        .select("id, company_name, ejar_enabled, ejar_broker_id, ejar_last_sync");
      const { data, error } = await (
        mine ? query.eq("id", mine) : query.order("created_at", { ascending: true })
      ).limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const leases = useQuery({
    queryKey: ["ejar-leases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leases")
        .select(
          "id, start_date, end_date, status, ejar_contract_no, ejar_status, tenants(full_name), units(unit_number, properties(name))",
        )
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveOrg = useMutation({
    mutationFn: async () => {
      if (!org.data) throw new Error("لا توجد إعدادات منشأة");
      const { error } = await supabase
        .from("org_settings")
        .update({
          ejar_enabled: enabled ?? org.data.ejar_enabled,
          ejar_broker_id: brokerId ?? org.data.ejar_broker_id,
        })
        .eq("id", org.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ إعدادات الربط");
      queryClient.invalidateQueries({ queryKey: ["org-ejar"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر الحفظ"),
  });

  const status = useQuery({
    queryKey: ["ejar-status"],
    queryFn: () => getEjarConnectionStatus(),
  });

  const sync = useMutation({
    mutationFn: () => syncEjar(),
    onSuccess: (result) => {
      if (!result.configured) {
        toast.error(
          "لم تُسجَّل بيانات الربط مع «إيجار» بعد — أرسل لي رابط البيئة ومعرّف العميل والمفتاح السري.",
        );
        return;
      }
      toast.success(
        `تمت المزامنة: ${result.contractsFetched} عقدًا · رُبط ${result.leasesLinked} · ${result.readingsImported} قراءة عداد`,
      );
      if (result.unmatched.length > 0) {
        toast.warning(`عقود لم يُعرف ما يقابلها في المنصة: ${result.unmatched.join(", ")}`);
      }
      queryClient.invalidateQueries({ queryKey: ["ejar-leases"] });
      queryClient.invalidateQueries({ queryKey: ["org-ejar"] });
      queryClient.invalidateQueries({ queryKey: ["meter-readings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّرت المزامنة"),
  });

  const saveContract = useMutation({
    mutationFn: async ({ leaseId, current }: { leaseId: string; current: string | null }) => {
      // The input is uncontrolled: `contracts` only has an entry once the user typed. Falling back
      // to "" used to wipe an existing contract number when "ربط" was clicked without editing.
      const value = (contracts[leaseId] ?? current ?? "").trim();
      const { error } = await supabase
        .from("leases")
        .update({
          ejar_contract_no: value || null,
          ejar_status: value ? "synced" : "pending",
        })
        .eq("id", leaseId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم ربط رقم العقد");
      queryClient.invalidateQueries({ queryKey: ["ejar-leases"] });
      queryClient.invalidateQueries({ queryKey: ["leases"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر الحفظ"),
  });

  return (
    <div className="space-y-6">
      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4 text-brass" />
            إعدادات الربط مع «إيجار»
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {org.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border border-border p-4">
                <div>
                  <p className="font-medium">تفعيل الربط</p>
                  <p className="text-sm text-muted-foreground">
                    عند تفعيله تُعتمد أرقام عقود «إيجار» كمرجع رسمي للعقود في المنصة.
                  </p>
                </div>
                <Switch
                  checked={enabled ?? org.data?.ejar_enabled ?? false}
                  onCheckedChange={setEnabled}
                />
              </div>
              <div>
                <Label>رقم الوسيط / المكتب في إيجار</Label>
                <Input
                  dir="ltr"
                  value={brokerId ?? org.data?.ejar_broker_id ?? ""}
                  onChange={(e) => setBrokerId(e.target.value)}
                  placeholder="مثال: 1010xxxxxx"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => saveOrg.mutate()} disabled={saveOrg.isPending}>
                  <Save className="size-4" />
                  حفظ
                </Button>
                <Button variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
                  <RefreshCw className={`size-4 ${sync.isPending ? "animate-spin" : ""}`} />
                  مزامنة الآن
                </Button>
                <span className="text-xs text-muted-foreground">
                  آخر مزامنة: {org.data?.ejar_last_sync ? shortDate(org.data.ejar_last_sync) : "—"}
                </span>
              </div>
              {status.data?.configured ? (
                <div className="rounded-md border border-primary/40 bg-accent p-4 text-sm">
                  <p className="font-medium">الربط الرسمي مع «إيجار» مُفعّل ✓</p>
                  <p className="mt-1 text-muted-foreground">
                    اضغط «مزامنة الآن» لجلب عقود مكتبك وأرقامها الرسمية وأرقام العدادات وقراءاتها،
                    وتتحدّث لوحة المؤشرات مباشرة بعد المزامنة.
                  </p>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">لتشغيل الربط الرسمي مع «إيجار»</p>
                  <p className="mt-1">
                    الربط جاهز بالكامل وينتظر بيانات مكتبك من «إيجار»: رابط البيئة، ومعرّف العميل،
                    والمفتاح السري (تُطلب بعد اعتماد المكتب كمزوّد خدمة). أرسلها لي وتعمل المزامنة
                    فورًا. حتى ذلك الحين اربط أرقام العقود من الجدول أدناه وتعمل باقي الشاشات
                    والتذكيرات عليها بشكل طبيعي.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">أرقام عقود «إيجار»</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {leases.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            (leases.data ?? []).map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border p-4"
              >
                <div>
                  <p className="font-medium">{l.tenants?.full_name ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">
                    {l.units?.properties?.name} · وحدة {l.units?.unit_number} ·{" "}
                    {shortDate(l.start_date)} — {shortDate(l.end_date)}
                  </p>
                  <Badge variant="outline" className="mt-2">
                    {leaseStatusLabel[l.status] ?? l.status}
                  </Badge>
                </div>
                <div className="flex items-end gap-2">
                  <div>
                    <Label className="text-xs">رقم عقد إيجار</Label>
                    <Input
                      dir="ltr"
                      className="w-48"
                      defaultValue={l.ejar_contract_no ?? ""}
                      onChange={(e) => setContracts((c) => ({ ...c, [l.id]: e.target.value }))}
                      placeholder="EJ-2026-000000"
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={saveContract.isPending}
                    onClick={() =>
                      saveContract.mutate({ leaseId: l.id, current: l.ejar_contract_no ?? null })
                    }
                  >
                    ربط
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetersSection() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [unitId, setUnitId] = useState("");
  const [meterType, setMeterType] = useState("electricity");
  const [reading, setReading] = useState("");
  const [readingDate, setReadingDate] = useState(todayRiyadh());

  const units = useQuery({
    queryKey: ["units-flat"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id, unit_number, electricity_meter_no, water_meter_no, properties(name)")
        .order("unit_number");
      if (error) throw error;
      return data ?? [];
    },
  });

  const readings = useQuery({
    queryKey: ["meter-readings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meter_readings")
        .select("id, meter_type, reading, reading_date, units(unit_number, properties(name))")
        .order("reading_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  const addReading = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("meter_readings").insert({
        unit_id: unitId,
        meter_type: meterType,
        reading: Number(reading),
        reading_date: readingDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setReading("");
      toast.success("تم تسجيل القراءة");
      queryClient.invalidateQueries({ queryKey: ["meter-readings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تسجيل القراءة"),
  });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer);
      const sheetName = book.SheetNames[0];
      if (!sheetName) throw new Error("الملف فارغ");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[sheetName]!);

      const unitByNumber = new Map(
        (units.data ?? []).map((u) => [String(u.unit_number).trim(), u.id]),
      );

      const payload: {
        unit_id: string;
        meter_type: string;
        reading: number;
        reading_date: string;
      }[] = [];
      const skipped: string[] = [];

      for (const row of rows) {
        const unitNumber = String(row["الوحدة"] ?? row["unit"] ?? row["unit_number"] ?? "").trim();
        const typeRaw = String(row["النوع"] ?? row["type"] ?? "electricity").trim();
        const readingValue = Number(row["القراءة"] ?? row["reading"] ?? NaN);
        const dateRaw = row["التاريخ"] ?? row["date"] ?? null;

        const id = unitByNumber.get(unitNumber);
        if (!id || !Number.isFinite(readingValue)) {
          skipped.push(unitNumber || "—");
          continue;
        }

        let date = todayRiyadh();
        if (typeof dateRaw === "number") {
          const parsed = XLSX.SSF.parse_date_code(dateRaw);
          if (parsed)
            date = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
        } else if (dateRaw) {
          const parsed = new Date(String(dateRaw));
          if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString().slice(0, 10);
        }

        payload.push({
          unit_id: id,
          meter_type:
            typeRaw.includes("مياه") || typeRaw.includes("water") ? "water" : "electricity",
          reading: readingValue,
          reading_date: date,
        });
      }

      if (payload.length === 0) throw new Error("لم يُقرأ أي سطر صحيح من الملف");
      const { error } = await supabase.from("meter_readings").insert(payload);
      if (error) throw error;
      return { inserted: payload.length, skipped: skipped.length };
    },
    onSuccess: (result) => {
      toast.success(
        `أُضيفت ${result.inserted} قراءة${result.skipped ? ` · تم تجاوز ${result.skipped} سطر` : ""}`,
      );
      queryClient.invalidateQueries({ queryKey: ["meter-readings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر استيراد الملف"),
  });

  return (
    <div className="space-y-6">
      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">تسجيل قراءة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label>الوحدة</Label>
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الوحدة" />
                </SelectTrigger>
                <SelectContent>
                  {(units.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.properties?.name} · وحدة {u.unit_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع العداد</Label>
              <Select value={meterType} onValueChange={setMeterType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="electricity">كهرباء</SelectItem>
                  <SelectItem value="water">مياه</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>القراءة</Label>
              <Input
                dir="ltr"
                inputMode="decimal"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                placeholder="12450"
              />
            </div>
            <div>
              <Label>التاريخ</Label>
              <Input
                type="date"
                dir="ltr"
                value={readingDate}
                onChange={(e) => setReadingDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={!unitId || !reading || addReading.isPending}
                onClick={() => addReading.mutate()}
              >
                تسجيل
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-dashed border-border p-4">
            <p className="flex items-center gap-2 font-medium">
              <FileSpreadsheet className="size-4 text-brass" />
              استيراد قراءات من ملف Excel
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              أعمدة الملف: <span className="font-medium">الوحدة</span> ·{" "}
              <span className="font-medium">النوع</span> (كهرباء/مياه) ·{" "}
              <span className="font-medium">القراءة</span> ·{" "}
              <span className="font-medium">التاريخ</span>
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importFile.mutate(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              className="mt-3"
              disabled={importFile.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" />
              اختيار ملف
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">أحدث القراءات</CardTitle>
        </CardHeader>
        <CardContent>
          {readings.isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <div className="divide-y divide-border">
              {(readings.data ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between py-3 text-sm">
                  <span>
                    {r.units?.properties?.name} · وحدة {r.units?.unit_number}
                  </span>
                  <span className="text-muted-foreground">
                    {r.meter_type === "water" ? "مياه" : "كهرباء"}
                  </span>
                  <span dir="ltr" className="font-medium">
                    {r.reading}
                  </span>
                  <span className="text-muted-foreground">{shortDate(r.reading_date)}</span>
                </div>
              ))}
              {(readings.data ?? []).length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">لا توجد قراءات بعد.</p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
