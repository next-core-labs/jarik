import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSignature } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { userErrorMessage } from "@/lib/auth-errors";
import {
  completeTenantActivation,
  declineTenantInvites,
  pendingTenantInvites,
} from "@/lib/tenant-portal.functions";

/**
 * An office invited this account (by its email) onto a lease: the person accepts or declines here.
 * Nothing is linked until they accept — an email invite is an invitation, not a link.
 */
export function TenantInvitesBanner({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const fetchPending = useServerFn(pendingTenantInvites);
  const accept = useServerFn(completeTenantActivation);
  const decline = useServerFn(declineTenantInvites);

  const pending = useQuery({
    queryKey: ["tenant-invites-pending"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => fetchPending(),
  });

  const decide = useMutation({
    mutationFn: async ({ id, yes }: { id: string; yes: boolean }) => {
      if (yes) await accept({ data: { inviteIds: [id] } });
      else await decline({ data: { inviteIds: [id] } });
      return yes;
    },
    onSuccess: (yes) => {
      toast.success(yes ? "رُبط العقد بحسابك" : "رُفضت الدعوة");
      void queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حفظ قرارك — حاول مرة أخرى")),
  });

  const invites = pending.data ?? [];
  if (!enabled || invites.length === 0) return null;
  return (
    <div className="space-y-2 border-b border-border bg-info-tint px-4 py-3 text-sm text-info-tint-foreground">
      {invites.map((inv) => (
        <div key={inv.id} className="flex flex-wrap items-center gap-2">
          <FileSignature className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            مكتب «{inv.officeName}» يدعوك مستأجرًا على عقد: {inv.unitLabel}
          </span>
          <Button
            size="sm"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ id: inv.id, yes: true })}
          >
            قبول
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ id: inv.id, yes: false })}
          >
            رفض
          </Button>
        </div>
      ))}
    </div>
  );
}
