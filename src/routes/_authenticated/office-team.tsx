import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Crown, Link2, MailCheck, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { isStaffRole, roleLabel, useMyRoles, type AppRole } from "@/lib/use-role";

export const Route = createFileRoute("/_authenticated/office-team")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "فريق المكتب — جارك" },
      {
        name: "description",
        content: "أضف موظفي مكتبك وفنييه، واربط ملاّكك ومستأجريك بحساباتهم.",
      },
    ],
  }),
  component: OfficeTeam,
});

type Person = {
  user_id: string;
  email: string;
  full_name: string;
  phone: string;
  roles: string[];
  relation: string;
  is_manager: boolean;
};

type Invitation = {
  id: string;
  email: string;
  kind: string;
  role: string;
  is_manager: boolean;
  created_at: string;
};

type LinkRequest = {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  kind: string;
  created_at: string;
};

const relationLabel: Record<string, string> = {
  member: "من فريق المكتب",
  client: "عميل مرتبط",
  linked: "مرتبط ببيانات المكتب",
};

function roleText(role: string) {
  return roleLabel[role as AppRole] ?? role;
}

function OfficeTeam() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const staff = isStaffRole(me?.roles ?? []);

  const people = useQuery({
    queryKey: ["office-people"],
    enabled: staff,
    queryFn: async (): Promise<Person[]> => {
      const { data, error } = await supabase.rpc("office_people");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invitations = useQuery({
    queryKey: ["office-invitations"],
    enabled: staff,
    queryFn: async (): Promise<Invitation[]> => {
      const { data, error } = await supabase.rpc("office_invitations");
      if (error) throw error;
      return data ?? [];
    },
  });

  // طلبات ربط ذاتي وصلت من مالك/مستأجر أدخل رمز هذا المكتب — عكس اتجاه دعوات "ربط مالك أو مستأجر"
  // فوق (هناك المكتب يدعو، هنا الحساب طلب والمكتب يبت).
  const linkRequests = useQuery({
    queryKey: ["office-link-requests"],
    enabled: staff,
    queryFn: async (): Promise<LinkRequest[]> => {
      const { data, error } = await supabase.rpc("office_link_requests");
      if (error) throw error;
      return data ?? [];
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["office-people"] });
    queryClient.invalidateQueries({ queryKey: ["office-invitations"] });
    queryClient.invalidateQueries({ queryKey: ["office-link-requests"] });
    queryClient.invalidateQueries({ queryKey: ["client-accounts"] });
  };

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("office_revoke_invitation", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("سُحبت الدعوة");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر سحب الدعوة"),
  });

  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"staff" | "technician">("staff");
  const [memberManager, setMemberManager] = useState(false);
  const addMember = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("office_add_member", {
        _email: memberEmail.trim(),
        _role: memberRole,
        _manager: memberRole === "staff" && memberManager,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُرسلت الدعوة — تنضم إلى الفريق بعد قبولها من صاحب الحساب");
      setMemberEmail("");
      setMemberManager(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال الدعوة"),
  });

  const [clientEmail, setClientEmail] = useState("");
  const [clientKind, setClientKind] = useState<"owner" | "tenant">("owner");
  const linkClient = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("office_link_client", {
        _email: clientEmail.trim(),
        _kind: clientKind,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُرسلت الدعوة — يرتبط الحساب بمكتبك بعد قبولها");
      setClientEmail("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال الدعوة"),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("office_remove_member", { _user: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُزيل الحساب من فريق المكتب");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّرت الإزالة"),
  });

  const setManager = useMutation({
    mutationFn: async (v: { userId: string; manager: boolean }) => {
      const { error } = await supabase.rpc("office_set_manager", {
        _user: v.userId,
        _manager: v.manager,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message || "تعذّر التحديث"),
  });

  const decideLinkRequest = useMutation({
    mutationFn: async (v: { id: string; accept: boolean }) => {
      const { error } = await supabase.rpc("office_decide_link_request", {
        _id: v.id,
        _accept: v.accept,
      });
      if (error) throw error;
      return v;
    },
    onSuccess: (v) => {
      toast.success(v.accept ? "ارتبط الحساب بمكتبك" : "رُفض الطلب");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر تنفيذ القرار"),
  });

  const unlinkClient = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("office_unlink_client", { _user: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُلغي الربط");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إلغاء الربط"),
  });

  if (me && !staff) {
    return (
      <>
        <PageHeader title="فريق المكتب" />
        <p className="text-muted-foreground">هذه الشاشة لموظفي المكتب.</p>
      </>
    );
  }

  const list = people.data ?? [];
  const iAmManager = list.some((p) => p.user_id === me?.userId && p.is_manager);
  const team = list.filter((p) => p.relation === "member");
  const clients = list.filter((p) => p.relation !== "member");

  return (
    <>
      <PageHeader
        title="فريق المكتب"
        subtitle="موظفو مكتبك وفنيّوه، والملاّك والمستأجرون المرتبطون به. لا يظهر هنا أي حساب من مكتب آخر."
      />

      {people.isLoading ? (
        <Skeleton className="h-64" />
      ) : people.error ? (
        <p className="text-destructive">تعذّر تحميل الفريق: {(people.error as Error).message}</p>
      ) : (
        <div className="space-y-6">
          {iAmManager ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="shadow-deed">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserPlus className="size-4" />
                    إضافة موظف أو فني
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addMember.mutate();
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="member-email">بريد الحساب (مسجّل في المنصة)</Label>
                      <Input
                        id="member-email"
                        type="email"
                        dir="ltr"
                        value={memberEmail}
                        onChange={(e) => setMemberEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>الدور</Label>
                      <Select
                        value={memberRole}
                        onValueChange={(v) => setMemberRole(v as "staff" | "technician")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="staff">موظف / محاسب</SelectItem>
                          <SelectItem value="technician">فني صيانة</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {memberRole === "staff" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={memberManager}
                          onCheckedChange={(v) => setMemberManager(v === true)}
                        />
                        مدير للمكتب (يضيف الموظفين ويربط العملاء)
                      </label>
                    ) : null}
                    <Button type="submit" disabled={addMember.isPending || !memberEmail.trim()}>
                      إرسال دعوة للفريق
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="shadow-deed">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Link2 className="size-4" />
                    ربط مالك أو مستأجر
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      linkClient.mutate();
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="client-email">بريد الحساب (مسجّل في المنصة)</Label>
                      <Input
                        id="client-email"
                        type="email"
                        dir="ltr"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>النوع</Label>
                      <Select
                        value={clientKind}
                        onValueChange={(v) => setClientKind(v as "owner" | "tenant")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">مالك</SelectItem>
                          <SelectItem value="tenant">مستأجر</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      تصل الدعوة لصاحب الحساب، وبعد قبولها يظهر في قوائم مكتبك لإسناد الوحدات وصفحات
                      الملاك.
                    </p>
                    <Button type="submit" disabled={linkClient.isPending || !clientEmail.trim()}>
                      إرسال دعوة الربط
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              إضافة الموظفين وربط العملاء من صلاحية مدير المكتب.
            </p>
          )}

          {(linkRequests.data ?? []).length > 0 ? (
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="size-4" />
                  طلبات ربط واردة
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {(linkRequests.data ?? []).map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.full_name || r.email}</p>
                      <p className="truncate text-xs text-muted-foreground" dir="ltr">
                        {r.email}
                      </p>
                      <Badge variant="secondary" className="mt-1">
                        {r.kind === "owner" ? "مالك" : "مستأجر"}
                      </Badge>
                    </div>
                    {iAmManager ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={decideLinkRequest.isPending}
                          onClick={() => decideLinkRequest.mutate({ id: r.id, accept: true })}
                        >
                          <Check className="size-4" />
                          قبول
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decideLinkRequest.isPending}
                          onClick={() => decideLinkRequest.mutate({ id: r.id, accept: false })}
                        >
                          <X className="size-4" />
                          رفض
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {(invitations.data ?? []).length > 0 ? (
            <Card className="shadow-deed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MailCheck className="size-4" />
                  دعوات بانتظار القبول
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                {(invitations.data ?? []).map((inv) => (
                  <div
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" dir="ltr">
                        {inv.email}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary">{roleText(inv.role)}</Badge>
                        {inv.is_manager ? <Badge>مدير المكتب</Badge> : null}
                        <Badge variant="outline">
                          {inv.kind === "member" ? "دعوة للفريق" : "دعوة ربط عميل"}
                        </Badge>
                      </div>
                    </div>
                    {iAmManager ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(inv.id)}
                      >
                        <Trash2 className="size-4" />
                        سحب الدعوة
                      </Button>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <PeopleCard title="فريق المكتب" empty="لا يوجد أعضاء.">
            {team.map((p) => (
              <PersonRow key={p.user_id} person={p} isMe={p.user_id === me?.userId}>
                {iAmManager && p.user_id !== me?.userId ? (
                  <>
                    {p.roles.includes("staff") ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setManager.isPending}
                        onClick={() =>
                          setManager.mutate({ userId: p.user_id, manager: !p.is_manager })
                        }
                      >
                        <Crown className="size-4" />
                        {p.is_manager ? "إلغاء الإدارة" : "ترقية لمدير"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={removeMember.isPending}
                      onClick={() => {
                        if (window.confirm(`إزالة ${p.full_name || p.email} من فريق المكتب؟`)) {
                          removeMember.mutate(p.user_id);
                        }
                      }}
                    >
                      <UserMinus className="size-4" />
                      إزالة
                    </Button>
                  </>
                ) : null}
              </PersonRow>
            ))}
          </PeopleCard>

          <PeopleCard title="الملاك والمستأجرون" empty="لا يوجد عملاء مرتبطون بعد.">
            {clients.map((p) => (
              <PersonRow key={p.user_id} person={p} isMe={false}>
                {iAmManager && p.relation === "client" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={unlinkClient.isPending}
                    onClick={() => {
                      if (window.confirm(`إلغاء ربط ${p.full_name || p.email} بمكتبك؟`)) {
                        unlinkClient.mutate(p.user_id);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                    إلغاء الربط
                  </Button>
                ) : null}
              </PersonRow>
            ))}
          </PeopleCard>
        </div>
      )}
    </>
  );
}

function PeopleCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border">
        {children.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function PersonRow({
  person,
  isMe,
  children,
}: {
  person: Person;
  isMe: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {person.full_name || person.email}
          {isMe ? <span className="ms-2 text-xs text-muted-foreground">(أنت)</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          {person.email}
          {person.phone ? ` · ${person.phone}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {person.is_manager ? <Badge>مدير المكتب</Badge> : null}
          {person.roles.map((r) => (
            <Badge key={r} variant="secondary">
              {roleText(r)}
            </Badge>
          ))}
          <Badge variant="outline">{relationLabel[person.relation] ?? person.relation}</Badge>
        </div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
