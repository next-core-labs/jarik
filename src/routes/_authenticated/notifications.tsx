import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CheckCheck, Handshake, Wrench } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { arNum, shortDate } from "@/lib/format";
import { isStaffRole, useMyRoles, type AppRole } from "@/lib/use-role";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/notifications")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "الإشعارات — جارك" },
      {
        name: "description",
        content: "كل ما يحتاج متابعتك: طلبات الصيانة، الدفعات، والرسائل.",
      },
      { property: "og:title", content: "الإشعارات — جارك" },
      { property: "og:description", content: "كل ما يحتاج متابعة في مكان واحد." },
    ],
  }),
  component: Notifications,
});

const kindLabel: Record<string, string> = {
  info: "عام",
  message: "رسالة",
  maintenance: "صيانة",
  reply: "رد",
  payment: "تحصيل",
  payment_reminder: "تذكير دفعة",
  announcement: "إعلان",
  lease: "عقد",
  unit: "وحدة",
  deal: "صفقة",
  agreement: "اتفاقية إدارة",
};

/** What this page is about, in the words of the role reading it. */
function subtitleFor(roles: AppRole[]) {
  if (isStaffRole(roles))
    return "رسائل واتساب المحوّلة إلى إجراءات، طلبات الصيانة، وتنبيهات التحصيل.";
  if (roles.includes("owner")) return "تحديثات وحداتك، والصيانة التي تنتظر موافقتك، والدفعات.";
  if (roles.includes("tenant")) return "تحديثات طلبات الصيانة، ودفعاتك، وإعلانات المبنى.";
  if (roles.includes("technician")) return "الأعمال المسندة لك وتحديثاتها.";
  return "كل ما يحتاج متابعتك في مكان واحد.";
}

type MaintenanceLink =
  | { to: "/maintenance" }
  | { to: "/portal" }
  | { to: "/tenant-dashboard"; hash: "maintenance" }
  | { to: "/owner-dashboard"; hash: "approvals" };

/**
 * Where a maintenance notification's job lives for this account. Notifications carry only
 * related_table/related_id (a unit for status updates, the request for approvals), so this links
 * to the role's maintenance screen rather than to one specific request.
 */
function maintenanceLinkFor(roles: AppRole[]): MaintenanceLink | null {
  if (isStaffRole(roles)) return { to: "/maintenance" };
  if (roles.includes("owner")) return { to: "/owner-dashboard", hash: "approvals" };
  if (roles.includes("tenant")) return { to: "/tenant-dashboard", hash: "maintenance" };
  if (roles.includes("technician")) return { to: "/portal" };
  return null;
}

/** Where a management-agreement notification is answered: the office's requests, or the owner's. */
function agreementLinkFor(roles: AppRole[]): "/agreements" | "/owner/agreements" | null {
  if (isStaffRole(roles)) return "/agreements";
  if (roles.includes("owner")) return "/owner/agreements";
  return null;
}

function Notifications() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const roles = me?.roles ?? [];
  const jobLink = maintenanceLinkFor(roles);
  const agreementLink = agreementLinkFor(roles);

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return [];
      // Staff can read every user's notifications (RLS), so filter in the query. Filtering after
      // `limit(100)` used to drop the staff member's own notifications behind other people's.
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, kind, source, read_at, created_at, user_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الإشعارات")),
  });

  const unread = (data ?? []).filter((n) => !n.read_at);

  return (
    <>
      <PageHeader title="الإشعارات" subtitle={subtitleFor(roles)} />

      <div className="mb-4 flex items-center gap-3">
        <Badge variant={unread.length ? "default" : "outline"}>
          {arNum(unread.length)} غير مقروء
        </Badge>
        {unread.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(unread.map((n) => n.id))}
          >
            <CheckCheck className="size-4" />
            تعليم الكل كمقروء
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : (data ?? []).length === 0 ? (
        <Card className="shadow-deed">
          <CardContent className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <BellOff className="size-5" />
            لا توجد إشعارات حتى الآن.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(data ?? []).map((n) => (
            <Card
              key={n.id}
              className={cn("shadow-deed", !n.read_at && "border-s-[3px] border-s-foreground")}
            >
              <CardContent className="flex items-start gap-3 pt-6">
                <Bell className="mt-0.5 size-4 shrink-0 text-brass" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{n.title}</p>
                    <Badge variant="secondary">{kindLabel[n.kind] ?? n.kind}</Badge>
                    <span className="text-xs text-muted-foreground">{shortDate(n.created_at)}</span>
                  </div>
                  {n.body ? (
                    <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                      {n.body}
                    </p>
                  ) : null}
                  {n.kind === "maintenance" && jobLink ? (
                    <Button variant="link" size="sm" className="h-auto px-0" asChild>
                      <Link {...jobLink}>
                        <Wrench className="size-4" />
                        عرض طلبات الصيانة
                      </Link>
                    </Button>
                  ) : null}
                  {n.kind === "agreement" && agreementLink ? (
                    <Button variant="link" size="sm" className="h-auto px-0" asChild>
                      <Link to={agreementLink}>
                        <Handshake className="size-4" />
                        {agreementLink === "/agreements" ? "مراجعة الطلب والرد" : "عرض الاتفاقية"}
                      </Link>
                    </Button>
                  ) : null}
                </div>
                {!n.read_at ? (
                  <Button variant="ghost" size="sm" onClick={() => markRead.mutate([n.id])}>
                    مقروء
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
