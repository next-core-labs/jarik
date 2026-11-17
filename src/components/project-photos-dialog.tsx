import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { UnitPhotosEditor } from "@/components/unit-photos-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { userErrorMessage } from "@/lib/auth-errors";
import {
  MAX_PROJECT_PHOTOS,
  mediaUrl,
  syncProjectPhotos,
  type ExistingPhoto,
  type PhotoItem,
} from "@/lib/unit-photos";

/**
 * صور المشروع: نفس محرّر صور الوحدة (إضافة، ترتيب، غلاف) وبنفس منطق المزامنة — المشروع يختلف
 * في المجلّد (`projects/<id>/`) والسقف فقط. الصورة الأولى هي غلاف المشروع في قائمة المشاريع.
 */
export function ProjectPhotosDialog({
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
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const saved = useQuery({
    queryKey: ["project-photos", projectId],
    enabled: open && Boolean(projectId),
    queryFn: async (): Promise<ExistingPhoto[]> => {
      const { data, error } = await supabase
        .from("project_photos")
        .select("id, path, position")
        .eq("project_id", projectId!)
        .order("position");
      if (error) throw error;
      return data ?? [];
    },
  });

  // تُحمَّل الصور المحفوظة مرة واحدة لكل فتح، فلا تُلغي ترتيبًا يعدّله المستخدم الآن.
  useEffect(() => {
    if (!open) {
      setLoaded(false);
      setItems([]);
      return;
    }
    if (loaded || !saved.data || saved.isFetching) return;
    setLoaded(true);
    setItems(
      saved.data.map((p) => ({
        key: p.id,
        id: p.id,
        path: p.path,
        file: null,
        preview: mediaUrl(p.path),
      })),
    );
  }, [open, loaded, saved.data, saved.isFetching]);

  const save = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("لا مشروع محدّد");
      await syncProjectPhotos(supabase, projectId, saved.data ?? [], items);
    },
    onSuccess: async () => {
      toast.success("حُفظت صور المشروع");
      await queryClient.invalidateQueries({ queryKey: ["project-photos", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["office-projects"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حفظ الصور")),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>صور المشروع — {projectName}</DialogTitle>
          <DialogDescription>
            الصورة الأولى هي غلاف المشروع في قائمة المشاريع. أضف المخطط العام والرندرات وصور الموقع
            — حتى {MAX_PROJECT_PHOTOS} صورة.
          </DialogDescription>
        </DialogHeader>

        {saved.isLoading ? (
          <Skeleton className="h-40" />
        ) : saved.error ? (
          <p className="text-sm text-destructive">تعذّر تحميل الصور المحفوظة.</p>
        ) : (
          <UnitPhotosEditor
            items={items}
            onChange={setItems}
            disabled={save.isPending}
            max={MAX_PROJECT_PHOTOS}
            hint={`${items.length} من ${MAX_PROJECT_PHOTOS} صورة — الأولى هي غلاف المشروع.`}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            إلغاء
          </Button>
          <Button
            disabled={save.isPending || saved.isLoading || Boolean(saved.error)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "جارٍ الحفظ…" : "حفظ الصور"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
