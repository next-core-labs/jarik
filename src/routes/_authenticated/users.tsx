import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { listAccounts, setAccountRole } from "@/lib/admin-users.functions";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleLabel, type AppRole, useMyRoles } from "@/lib/use-role";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/users")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "المستخدمون والأدوار — جارك" },
      { name: "description", content: "إدارة حسابات المستخدمين وتعيين دور كل حساب في النظام." },
      { property: "og:title", content: "المستخدمون والأدوار — جارك" },
      { property: "og:description", content: "تعيين أدوار: مدير، موظف، مالك، مستأجر، فني." },
    ],
  }),
  component: UsersPage,
});

const roles: AppRole[] = ["admin", "staff", "owner", "tenant", "technician"];

function UsersPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const isAdmin = me?.roles.includes("admin");

  const fetchAccounts = useServerFn(listAccounts);
  const updateRole = useServerFn(setAccountRole);

  const { data, isLoading, error } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => fetchAccounts(),
    enabled: !!isAdmin,
  });

  const mutate = useMutation({
    mutationFn: (vars: { userId: string; role: AppRole }) => updateRole({ data: vars }),
    onSuccess: () => {
      toast.success("تم تحديث الدور");
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["my-roles"] });
    },
    onError: () => toast.error("تعذّر تحديث الدور"),
  });

  if (!me) return <Skeleton className="h-64" />;

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="المستخدمون والأدوار" />
        <p className="text-sm text-muted-foreground">هذه الصفحة لمدير النظام فقط.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="المستخدمون والأدوار"
        subtitle="كل حساب يرى ما يخصّه فقط: المالك عقاراته، المستأجر عقده ومدفوعاته، الفني أعماله."
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : error ? (
        <p className="text-sm text-destructive">تعذّر تحميل الحسابات.</p>
      ) : (
        <Card className="shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">{(data ?? []).length} حساب</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data ?? []).map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background p-4"
              >
                <div>
                  <p className="font-medium" dir="ltr">
                    {u.email}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    انضم {shortDate(u.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {u.roles.map((r) => (
                    <Badge key={r} variant="outline">
                      {roleLabel[r as AppRole] ?? r}
                    </Badge>
                  ))}
                  <Select
                    value={u.roles[0] ?? ""}
                    onValueChange={(role) => mutate.mutate({ userId: u.id, role: role as AppRole })}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="تعيين دور" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
