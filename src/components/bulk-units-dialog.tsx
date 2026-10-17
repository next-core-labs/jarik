import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseAmount } from "@/lib/public-form";
import { FURNISHING_LABEL, FURNISHING_OPTIONS, type Furnishing } from "@/lib/furniture";
import { SINGLE_UNIT_TYPE_GROUPS } from "@/lib/property-types";
import { planUnitNumbers, type Numbering } from "@/lib/unit-numbering";

const MAX_UNITS = 300;

const floorLabel = (floor: number) => (floor === 0 ? "الأرضي" : String(floor));

/**
 * إضافة شقق العمارة دفعة واحدة بنفس المواصفات — ثم تعدّل كل شقة (رقم الصك، الأثاث، العدادات) لوحدها.
 * Numbers the building already has are skipped, so running it twice never duplicates an apartment.
 */
export function BulkUnitsDialog({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  district,
  floorsCount,
  existingNumbers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: string;
  propertyName: string;
  district: string | null;
  floorsCount: number | null;
  existingNumbers: string[];
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    fromFloor: "1",
    toFloor: "",
    perFloor: "4",
    numbering: "floor" as Numbering,
    start: "1",
    unit_type: "شقة",
    rooms: "3",
    halls: "1",
    bathrooms: "2",
    area: "",
    annual_rent: "",
    furnishing: "none" as Furnishing,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open) setForm((f) => ({ ...f, toFloor: floorsCount ? String(floorsCount) : "" }));
  }, [open, floorsCount]);

  const whole = (v: string, min = 0) => {
    const n = parseAmount(v);
    return n != null && Number.isInteger(n) && n >= min ? n : null;
  };
  const fromFloor = whole(form.fromFloor);
  const toFloor = whole(form.toFloor);
  const perFloor = whole(form.perFloor, 1);
  const start = whole(form.start, 1);
  const rooms = parseAmount(form.rooms);
  const halls = parseAmount(form.halls);
  const bathrooms = parseAmount(form.bathrooms);
  const area = parseAmount(form.area);
  const rent = parseAmount(form.annual_rent);

  const existing = useMemo(() => new Set(existingNumbers.map((n) => n.trim())), [existingNumbers]);
  const planned =
    fromFloor != null &&
    toFloor != null &&
    perFloor != null &&
    start != null &&
    toFloor >= fromFloor
      ? planUnitNumbers({ fromFloor, toFloor, perFloor, numbering: form.numbering, start })
      : [];
  const fresh = planned.filter((p) => !existing.has(p.unit_number));
  const skipped = planned.length - fresh.length;

  const error =
    fromFloor == null || toFloor == null
      ? "حدّد الأدوار من وإلى (0 للأرضي)"
      : toFloor < fromFloor
        ? "الدور الأخير قبل الدور الأول"
        : perFloor == null
          ? "عدد الوحدات في كل دور رقم صحيح من 1"
          : start == null
            ? "رقم البداية رقم صحيح من 1"
            : planned.length > MAX_UNITS
              ? `الحد ${MAX_UNITS} وحدة في المرة الواحدة`
              : rooms === null || halls === null || bathrooms === null || area === null
                ? "الغرف والصالات والحمامات والمساحة أرقام"
                : rent === null
                  ? "الإيجار رقم بالريال"
                  : fresh.length === 0
                    ? "كل هذه الأرقام مسجّلة في العقار بالفعل"
                    : null;

  const save = useMutation({
    mutationFn: async () => {
      if (error) throw new Error(error);
      const rows = fresh.map((p) => ({
        property_id: propertyId,
        unit_number: p.unit_number,
        unit_type: form.unit_type,
        floor_no: floorLabel(p.floor),
        district: district || null,
        rooms: rooms ?? null,
        halls: halls ?? 0,
        bathrooms: bathrooms ?? 0,
        area: area ?? null,
        annual_rent: rent ?? 0,
        furnishing: form.furnishing,
        // Published one by one once each has its photos and description.
        market_listed: false,
      }));
      const { error: insertError } = await supabase.from("units").insert(rows);
      if (insertError) throw insertError;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(`أُضيفت ${n} وحدة — افتح كل وحدة لإضافة صكها وأثاثها وعداداتها`);
      queryClient.invalidateQueries({ queryKey: ["properties-with-units"] });
      queryClient.invalidateQueries({ queryKey: ["owner-own-properties"] });
      queryClient.invalidateQueries({ queryKey: ["owner-agreements-properties"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّرت إضافة الوحدات")),
  });

  const preview = fresh.slice(0, 12).map((p) => p.unit_number);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">إضافة وحدات دفعة واحدة</DialogTitle>
          <DialogDescription>
            {propertyName} — وحدات بنفس المواصفات، ثم تعدّل ما يختلف في كل وحدة.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="من الدور (0 = الأرضي)">
            <Input
              inputMode="numeric"
              value={form.fromFloor}
              onChange={(e) => set("fromFloor", e.target.value)}
            />
          </Field>
          <Field label="إلى الدور">
            <Input
              inputMode="numeric"
              value={form.toFloor}
              onChange={(e) => set("toFloor", e.target.value)}
            />
          </Field>
          <Field label="وحدات في كل دور">
            <Input
              inputMode="numeric"
              value={form.perFloor}
              onChange={(e) => set("perFloor", e.target.value)}
            />
          </Field>
          <Field label="الترقيم">
            <Select value={form.numbering} onValueChange={(v) => set("numbering", v as Numbering)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="floor">حسب الدور (101، 102…)</SelectItem>
                <SelectItem value="sequential">تسلسل متصل (1، 2، 3…)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.numbering === "sequential" ? (
            <Field label="يبدأ من">
              <Input
                inputMode="numeric"
                value={form.start}
                onChange={(e) => set("start", e.target.value)}
              />
            </Field>
          ) : null}
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">مواصفات كل وحدة</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="النوع">
              <Select value={form.unit_type} onValueChange={(v) => set("unit_type", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SINGLE_UNIT_TYPE_GROUPS.map((g) => (
                    <SelectGroup key={g.group}>
                      <SelectLabel>{g.group}</SelectLabel>
                      {g.types.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="الغرف">
              <Input
                inputMode="numeric"
                value={form.rooms}
                onChange={(e) => set("rooms", e.target.value)}
              />
            </Field>
            <Field label="الصالات">
              <Input
                inputMode="numeric"
                value={form.halls}
                onChange={(e) => set("halls", e.target.value)}
              />
            </Field>
            <Field label="الحمامات">
              <Input
                inputMode="numeric"
                value={form.bathrooms}
                onChange={(e) => set("bathrooms", e.target.value)}
              />
            </Field>
            <Field label="المساحة (م²)">
              <Input
                inputMode="decimal"
                value={form.area}
                onChange={(e) => set("area", e.target.value)}
              />
            </Field>
            <Field label="الإيجار السنوي (ريال)">
              <Input
                inputMode="decimal"
                value={form.annual_rent}
                onChange={(e) => set("annual_rent", e.target.value)}
              />
            </Field>
            <Field label="التأثيث">
              <Select
                value={form.furnishing}
                onValueChange={(v) => set("furnishing", v as Furnishing)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FURNISHING_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FURNISHING_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <div className="rounded-md bg-muted/40 p-3 text-sm">
          {error ? (
            <p className="text-destructive">{error}</p>
          ) : (
            <>
              <p>
                ستُضاف <span className="font-medium">{fresh.length}</span> وحدة
                {skipped > 0 ? ` (تُتخطّى ${skipped} مسجّلة بالفعل)` : ""}:
              </p>
              <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                {preview.join(" · ")}
                {fresh.length > preview.length ? " …" : ""}
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={Boolean(error) || save.isPending}>
            {save.isPending ? "جارٍ الإضافة..." : `إضافة ${fresh.length || ""} وحدة`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
