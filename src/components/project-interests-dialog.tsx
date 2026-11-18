import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { arCount, shortDate } from "@/lib/format";
import { phoneHref, whatsappHref } from "@/lib/market";

/**
 * المهتمّون بمشروع: اسم كل مهتمّ وجواله ونموذجه وملاحظته، مع اتصال وواتساب و«تم التواصل».
 *
 * قبل هذه النافذة كان العدد وحده يظهر على البطاقة («3 اهتمام») والاسم والجوال يصلان في إشعار
 * الموظفين فقط — فبعد مرور الإشعار يضيع العميل بلا طريق لاسترجاعه. الصلاحية كانت موجودة في
 * القاعدة (policy project_interests_office) والنقص في الواجهة وحدها.
 */

const STATUS_LABEL: Record<string, string> = {
  open: "جديد",
  contacted: "تم التواصل",
  closed: "مغلق",
};

type InterestRow = {
  id: string;
  full_name: string;
  phone: string;
  notes: string | null;
  status: string;
  created_at: string;
  model_id: string | null;
  project_models: { name: string } | null;
};

export function ProjectInterestsDialog({
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

  const interests = useQuery({
    queryKey: ["project-interests", projectId],
    enabled: open && Boolean(projectId),
    queryFn: async (): Promise<InterestRow[]> => {
      const { data, error } = await supabase
        .from("project_interests")
        .select("id, full_name, phone, notes, status, created_at, model_id, project_models(name)")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as InterestRow[];
    },
  });

  // الحالة هي كل ما يملكه المكتب هنا: لا حذف ولا تعديل لبيانات المهتمّ نفسه.
  const markContacted = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("project_interests")
        .update({ status: "contacted" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("سُجّل أنك تواصلت معه");
      void queryClient.invalidateQueries({ queryKey: ["project-interests", projectId] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الحالة")),
  });

  const rows = interests.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>المهتمّون بـ«{projectName}»</DialogTitle>
          <DialogDescription>
            من سجّل اهتمامه بهذا المشروع من صفحته العامة — تواصل معه من هنا.
          </DialogDescription>
        </DialogHeader>

        {interests.isLoading ? (
          <Skeleton className="h-40" />
        ) : interests.isError ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            تعذّر تحميل المهتمّين — حاول مرة أخرى.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            لا مهتمّين بعد. يصل هنا كل من يسجّل اهتمامه من صفحة المشروع العامة.
          </p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              {arCount(rows.length, {
                one: "مهتمّ واحد",
                two: "مهتمّان",
                few: "مهتمّين",
                many: "مهتمًّا",
              })}
            </p>
            {rows.map((r) => (
              <article
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{r.full_name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                      {r.phone}
                    </span>
                  </div>
                  <Badge variant={r.status === "open" ? "secondary" : "outline"}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.project_models?.name ? `النموذج: ${r.project_models.name} · ` : ""}
                  {shortDate(r.created_at)}
                </p>
                {r.notes ? <p className="text-sm">{r.notes}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const wa = whatsappHref(
                      r.phone,
                      `مرحبًا ${r.full_name}، بخصوص اهتمامك بمشروع ${projectName}`,
                    );
                    const tel = phoneHref(r.phone);
                    return (
                      <>
                        {wa ? (
                          <Button size="sm" variant="whatsapp" asChild>
                            <a href={wa} target="_blank" rel="noreferrer">
                              <MessageCircle className="size-4" />
                              واتساب
                            </a>
                          </Button>
                        ) : null}
                        {tel ? (
                          <Button size="sm" variant="outline" asChild>
                            <a href={tel}>
                              <Phone className="size-4" />
                              اتصال
                            </a>
                          </Button>
                        ) : null}
                      </>
                    );
                  })()}
                  {r.status === "open" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={markContacted.isPending}
                      onClick={() => markContacted.mutate(r.id)}
                    >
                      <Check className="size-4" />
                      تم التواصل
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
