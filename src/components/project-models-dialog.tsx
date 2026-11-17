import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileImage, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { userErrorMessage } from "@/lib/auth-errors";
import { sar } from "@/lib/format";
import { SINGLE_UNIT_TYPE_GROUPS } from "@/lib/property-types";
import { clearModelFloorPlan, uploadModelFloorPlan } from "@/lib/project-plans";
import { ACCEPTED_IMAGE_TYPES, mediaUrl, validateImageFile } from "@/lib/unit-photos";

/**
 * نماذج وحدات المشروع: «نموذج أ — شقة 3 غرف 140م بسعر 900,000». النموذج ليس وحدة بعينها بل صنف
 * منها، فله عدد وحدات وعدد متاح. السعر إلزامي (القاعدة: price > 0)، لأن مشروعًا بلا أسعار لا يفيد
 * الباحث — و«يبدأ من» في صفحة المشروع يُحتسب من أقل هذه الأسعار.
 */

type Model = {
  id: string;
  name: string;
  unit_type: string;
  area: number | null;
  rooms: number | null;
  halls: number | null;
  bathrooms: number | null;
  price: number;
  units_count: number | null;
  available_count: number | null;
  floor_plan_path: string | null;
  position: number;
};

const blank = {
  name: "",
  unit_type: "شقة",
  area: "",
  rooms: "",
  bathrooms: "",
  price: "",
  units_count: "",
  available_count: "",
};

export function ProjectModelsDialog({
  open,
  projectId,
  projectName,
  onClose,
}: {
  open: boolean;
  projectId: string | null;
  projectName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(blank);

  const models = useQuery({
    queryKey: ["project-models", projectId],
    enabled: open && Boolean(projectId),
    queryFn: async (): Promise<Model[]> => {
      const { data, error } = await supabase
        .from("project_models")
        .select(
          "id, name, unit_type, area, rooms, halls, bathrooms, price, units_count, available_count, floor_plan_path, position",
        )
        .eq("project_id", projectId!)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Model[];
    },
  });

  const int = (v: string) => {
    const n = Number(v.replace(/[^\d]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  };
  const dec = (v: string) => {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const add = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("لا مشروع محدّد");
      const price = dec(form.price);
      if (!price) throw new Error("سعر النموذج مطلوب");
      const units = int(form.units_count);
      const available = int(form.available_count);
      if (units !== null && available !== null && available > units) {
        throw new Error("المتاح لا يكون أكبر من إجمالي وحدات النموذج");
      }
      const { error } = await supabase.from("project_models").insert({
        project_id: projectId,
        name: form.name.trim(),
        unit_type: form.unit_type,
        area: dec(form.area),
        rooms: int(form.rooms),
        bathrooms: int(form.bathrooms),
        price,
        units_count: units,
        available_count: available,
        position: (models.data?.length ?? 0) + 1,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("أُضيف النموذج");
      setForm(blank);
      await queryClient.invalidateQueries({ queryKey: ["project-models", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["office-projects"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إضافة النموذج")),
  });

  const planInput = useRef<HTMLInputElement>(null);
  const [planFor, setPlanFor] = useState<Model | null>(null);

  const uploadPlan = useMutation({
    mutationFn: async (input: { model: Model; file: File }) => {
      if (!projectId) throw new Error("لا مشروع محدّد");
      const problem = validateImageFile(input.file);
      if (problem) throw new Error(problem);
      await uploadModelFloorPlan(supabase, {
        projectId,
        modelId: input.model.id,
        file: input.file,
        previousPath: input.model.floor_plan_path,
      });
    },
    onSuccess: async () => {
      toast.success("حُفظ مخطط النموذج");
      await queryClient.invalidateQueries({ queryKey: ["project-models", projectId] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر رفع المخطط")),
  });

  const removePlan = useMutation({
    mutationFn: async (model: Model) =>
      await clearModelFloorPlan(supabase, { modelId: model.id, path: model.floor_plan_path }),
    onSuccess: async () => {
      toast.success("حُذف المخطط");
      await queryClient.invalidateQueries({ queryKey: ["project-models", projectId] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حذف المخطط")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_models").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("حُذف النموذج");
      await queryClient.invalidateQueries({ queryKey: ["project-models", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["office-projects"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حذف النموذج")),
  });

  const rows = models.data ?? [];
  const canAdd = form.name.trim().length >= 1 && dec(form.price) !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>نماذج الوحدات — {projectName}</DialogTitle>
          <DialogDescription>
            النموذج صنف من الوحدات لا وحدة بعينها. «يبدأ من» في صفحة المشروع يُحتسب من أقل أسعار
            النماذج، ولا يُنشر المشروع بلا نموذج واحد على الأقل. ومخطط كل نموذج صورة واحدة تُرفع من
            عمود «المخطط» بعد إضافته.
          </DialogDescription>
        </DialogHeader>

        {models.isLoading ? (
          <Skeleton className="h-28" />
        ) : rows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">النموذج</th>
                  <th className="px-3 py-2 text-start font-medium">النوع</th>
                  <th className="px-3 py-2 text-start font-medium">المساحة</th>
                  <th className="px-3 py-2 text-start font-medium">غرف</th>
                  <th className="px-3 py-2 text-start font-medium">حمامات</th>
                  <th className="px-3 py-2 text-start font-medium">المتاح</th>
                  <th className="px-3 py-2 text-start font-medium">السعر</th>
                  <th className="px-3 py-2 text-start font-medium">المخطط</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 font-semibold">{m.name}</td>
                    <td className="px-3 py-2">{m.unit_type}</td>
                    <td className="px-3 py-2 tabular-nums">{m.area ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{m.rooms ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{m.bathrooms ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {m.available_count != null
                        ? `${m.available_count}${m.units_count ? ` / ${m.units_count}` : ""}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold tabular-nums">{sar(Number(m.price))}</td>
                    <td className="px-3 py-2">
                      {m.floor_plan_path ? (
                        <span className="flex items-center gap-1.5">
                          <a
                            href={mediaUrl(m.floor_plan_path)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                          >
                            <FileImage className="size-4 text-brass" aria-hidden />
                            عرض
                          </a>
                          <button
                            type="button"
                            aria-label={`حذف مخطط ${m.name}`}
                            disabled={removePlan.isPending}
                            onClick={() => removePlan.mutate(m)}
                            className="grid size-6 place-items-center text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                          >
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={uploadPlan.isPending}
                          onClick={() => {
                            setPlanFor(m);
                            planInput.current?.click();
                          }}
                          className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                        >
                          <Upload className="size-3.5" aria-hidden />
                          {uploadPlan.isPending && planFor?.id === m.id ? "جارٍ الرفع…" : "أضف"}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-label={`حذف ${m.name}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(m.id)}
                        className="grid size-7 place-items-center text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            لا نماذج بعد — أضف أول نموذج أدناه.
          </p>
        )}

        {/* مُنتقي ملف واحد مشترك لكل الصفوف — يُفتح للنموذج الذي ضُغط زرّه. */}
        <input
          ref={planInput}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && planFor) uploadPlan.mutate({ model: planFor, file });
          }}
        />

        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <p className="text-sm font-semibold">إضافة نموذج</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Cell label="الاسم">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={80}
                placeholder="نموذج أ"
              />
            </Cell>
            <Cell label="النوع">
              <Select
                value={form.unit_type}
                onValueChange={(v) => setForm((f) => ({ ...f, unit_type: v }))}
              >
                <SelectTrigger aria-label="النوع">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SINGLE_UNIT_TYPE_GROUPS.flatMap((g) => g.types).map((ty) => (
                    <SelectItem key={ty} value={ty}>
                      {ty}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Cell>
            <Cell label="المساحة (م²)">
              <Input
                value={form.area}
                onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                inputMode="decimal"
              />
            </Cell>
            <Cell label="السعر (ر.س)">
              <Input
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                inputMode="numeric"
                placeholder="900000"
              />
            </Cell>
            <Cell label="الغرف">
              <Input
                value={form.rooms}
                onChange={(e) => setForm((f) => ({ ...f, rooms: e.target.value }))}
                inputMode="numeric"
              />
            </Cell>
            <Cell label="الحمامات">
              <Input
                value={form.bathrooms}
                onChange={(e) => setForm((f) => ({ ...f, bathrooms: e.target.value }))}
                inputMode="numeric"
              />
            </Cell>
            <Cell label="عدد وحدات النموذج">
              <Input
                value={form.units_count}
                onChange={(e) => setForm((f) => ({ ...f, units_count: e.target.value }))}
                inputMode="numeric"
              />
            </Cell>
            <Cell label="المتاح منها">
              <Input
                value={form.available_count}
                onChange={(e) => setForm((f) => ({ ...f, available_count: e.target.value }))}
                inputMode="numeric"
              />
            </Cell>
          </div>
          <Button
            className="self-start"
            disabled={!canAdd || add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus className="size-4" />
            {add.isPending ? "جارٍ الإضافة…" : "أضف النموذج"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
