import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { HQ_PERMISSION_LABEL } from "@/lib/hq-permissions";

type Invitation = {
  id: string;
  org_id: string;
  office_name: string;
  kind: string;
  role: string;
  is_manager: boolean;
};

type HqInvitation = {
  id: string;
  permissions: string[];
  created_at: string;
};

const roleText: Record<string, string> = {
  staff: "موظف",
  technician: "فني صيانة",
  owner: "مالك",
  tenant: "مستأجر",
};

/**
 * An office cannot attach an account to itself on its own: it invites, and the account decides.
 * Shown to everyone, because an invitation can reach a portal user or an office employee alike.
 */
export function InvitationsBanner() {
  const queryClient = useQueryClient();

  const invitations = useQuery({
    queryKey: ["my-invitations"],
    staleTime: 60_000,
    queryFn: async (): Promise<Invitation[]> => {
      const { data, error } = await supabase.rpc("my_invitations");
      if (error) throw error;
      return data ?? [];
    },
  });

  const hqInvitations = useQuery({
    queryKey: ["my-hq-invitations"],
    staleTime: 60_000,
    queryFn: async (): Promise<HqInvitation[]> => {
      const { data, error } = await supabase.rpc("my_hq_invitations");
      if (error) throw error;
      return data ?? [];
    },
  });

  const answer = useMutation({
    mutationFn: async (v: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc(v.accept ? "accept_invitation" : "decline_invitation", {
        _id: v.id,
      });
      if (error) throw error;
      return v;
    },
    onSuccess: async (v) => {
      toast.success(v.accept ? "انضممت للمكتب" : "رُفضت الدعوة");
      // Accepting changes the account's roles and office, so everything on screen is now stale.
      await queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تنفيذ الطلب"),
  });

  const answerHq = useMutation({
    mutationFn: async (v: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc(
        v.accept ? "accept_hq_invitation" : "decline_hq_invitation",
        { _id: v.id },
      );
      if (error) throw error;
      return v;
    },
    onSuccess: async (v) => {
      toast.success(v.accept ? "صرت مدير عام مفوَّض" : "رُفضت الدعوة");
      await queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تنفيذ الطلب"),
  });

  const rows = invitations.data ?? [];
  const hqRows = hqInvitations.data ?? [];
  if (rows.length === 0 && hqRows.length === 0) return null;

  return (
    <div className="border-b border-border bg-accent/40">
      {rows.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
        >
          <span className="flex items-center gap-2">
            <MailCheck className="size-4 shrink-0" aria-hidden />
            دعاك «{inv.office_name}» للانضمام بصفة {roleText[inv.role] ?? inv.role}
            {inv.is_manager ? " (مدير للمكتب)" : ""}.
          </span>
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: inv.id, accept: true })}
            >
              قبول
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: inv.id, accept: false })}
            >
              رفض
            </Button>
          </span>
        </div>
      ))}
      {hqRows.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
        >
          <span className="flex items-center gap-2">
            <MailCheck className="size-4 shrink-0" aria-hidden />
            دعاك مالك المنصة للانضمام كمدير عام مفوَّض بصلاحيات:{" "}
            {inv.permissions.map((p) => HQ_PERMISSION_LABEL[p] ?? p).join("، ")}.
          </span>
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={answerHq.isPending}
              onClick={() => answerHq.mutate({ id: inv.id, accept: true })}
            >
              قبول
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={answerHq.isPending}
              onClick={() => answerHq.mutate({ id: inv.id, accept: false })}
            >
              رفض
            </Button>
          </span>
        </div>
      ))}
    </div>
  );
}
