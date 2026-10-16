import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  Ban,
  Banknote,
  Building2,
  ChevronDown,
  Download,
  Eye,
  Handshake,
  KeyRound,
  LogIn,
  Megaphone,
  MessageSquareWarning,
  Plus,
  Search,
  Send,
  Star,
  Store,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import {
  subscriberDirectory,
  subscriberActivityLog,
  subscriberOverview,
  platformAuditLog,
  hqImpersonateStart,
  hqSetAccountSuspended,
  hqSetAccountRole,
  hqCreateSubscriberAccount,
  platformOverview,
  platformGrowth,
  platformSiteVisits,
  platformAccounting,
  platformCommissions,
  addPlatformCommission,
  markCommissionCollected,
  platformAnnouncements,
  sendPlatformAnnouncement,
  platformFeedback,
  updateFeedbackStatus,
  platformSettings,
  hqUpdatePlatformSettings,
  platformSystemHealth,
} from "@/lib/super-admin.functions";
import { actionLabel, tableLabel, summarize } from "@/lib/audit-format";
import {
  HQ_PERMISSION_LABEL,
  HQ_PERMISSION_OPTIONS,
  UNENFORCED_HQ_PERMISSIONS,
} from "@/lib/hq-permissions";
import { exportWorkbook } from "@/lib/export-excel";
import { PageHeader } from "@/components/app-shell";
import { HqDemoRequests } from "@/components/hq-demo-requests";
import { HqOfficesPanel } from "@/components/hq-offices-panel";
import { DirectMessagesTab } from "@/components/direct-messages-tab";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { roleLabel, type AppRole, useMyRoles } from "@/lib/use-role";
import { shortDate, sar } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/hq")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "لوحة المدير العام — جارك" },
      {
        name: "description",
        content: "نظرة عامة على المنصة كلها: كل المشتركين عبر كل المكاتب وسجل نشاط كل واحد منهم.",
      },
      { property: "og:title", content: "لوحة المدير العام — جارك" },
      { property: "og:description", content: "إدارة المشتركين والمحاسبة وأعمال فريق منصة جارك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HqPage,
});

// Read by app-shell.tsx's global "return to admin" banner too — that's what lets a super_admin get
// back from any page the impersonated session navigates to, not just from /hq itself, so only
// enterAccount() below writes this key; there is no local restore button/UI on this page anymore.
const RESTORE_KEY = "aqari-hq-restore";

const GROWTH_CHART_CONFIG: ChartConfig = {
  signups: { label: "تسجيلات", color: "var(--chart-1)" },
  offices: { label: "مكاتب", color: "var(--chart-2)" },
};

// admin/super_admin مستثنيان عمدًا — راجع تعليق hqSetAccountRole بـsuper-admin.functions.ts لسبب ذلك.
const HQ_ACCOUNT_ROLES: AppRole[] = ["staff", "owner", "tenant", "technician"];

function HqPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMyRoles();
  const isSuperAdmin = me?.roles.includes("super_admin");

  // A delegated hq_admins row also unlocks the page — read via the table's own self-read policy.
  const myHqPermissions = useQuery({
    queryKey: ["my-hq-permissions", me?.userId],
    enabled: !!me?.userId && !isSuperAdmin,
    retry: false,
    queryFn: async () => {
      const { data } = await supabase
        .from("hq_admins")
        .select("permissions")
        .eq("user_id", me!.userId!)
        .maybeSingle();
      return data?.permissions ?? [];
    },
  });
  const myPermissions = isSuperAdmin ? HQ_PERMISSION_OPTIONS : (myHqPermissions.data ?? []);
  const hasAccess = myPermissions.length > 0;
  const canSubscribers = myPermissions.includes("subscribers");
  const canAccounting = myPermissions.includes("accounting");
  const canCommissions = myPermissions.includes("commissions");
  const canReviews = myPermissions.includes("reviews");
  const canOffices = myPermissions.includes("offices");
  const canSystem = myPermissions.includes("system");
  const canAnnouncements = myPermissions.includes("announcements");

  // Controlled (not just `defaultValue`) so a subscriber row's "دعوة كمدير عام مفوَّض" button can
  // jump straight to the "المدراء" tab with the email pre-filled.
  const [tab, setTab] = useState(() =>
    canSubscribers
      ? "subscribers"
      : canAccounting
        ? "accounting"
        : canCommissions
          ? "commissions"
          : canReviews
            ? "reviews"
            : canOffices
              ? "offices"
              : canSystem
                ? "system"
                : canAnnouncements
                  ? "announcements"
                  : "admins",
  );
  const [hqInviteEmail, setHqInviteEmail] = useState("");
  function inviteAsHqAdmin(email: string) {
    setHqInviteEmail(email);
    setTab("admins");
  }

  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  const fetchDirectory = useServerFn(subscriberDirectory);
  const fetchOverview = useServerFn(platformOverview);
  const fetchGrowth = useServerFn(platformGrowth);
  const fetchSiteVisits = useServerFn(platformSiteVisits);
  const fetchActivity = useServerFn(subscriberActivityLog);
  const fetchAccountOverview = useServerFn(subscriberOverview);
  const fetchAccounting = useServerFn(platformAccounting);
  const startImpersonate = useServerFn(hqImpersonateStart);

  async function enterAccount(userId: string) {
    setEntering(userId);
    try {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) {
        localStorage.setItem(
          RESTORE_KEY,
          JSON.stringify({
            access_token: s.session.access_token,
            refresh_token: s.session.refresh_token,
          }),
        );
      }
      const res = await startImpersonate({ data: { userId } });
      const { error } = await supabase.auth.verifyOtp({
        type: "magiclink",
        email: res.email,
        token: res.otp,
      });
      if (error) throw error;
      queryClient.clear();
      window.location.href = "/portal";
    } catch (e) {
      localStorage.removeItem(RESTORE_KEY);
      toast.error(userErrorMessage(e, "تعذّر الدخول على الحساب"));
      setEntering(null);
    }
  }

  const directory = useQuery({
    queryKey: ["hq-subscriber-directory"],
    queryFn: () => fetchDirectory(),
    enabled: canSubscribers,
  });

  const overview = useQuery({
    queryKey: ["hq-platform-overview"],
    queryFn: () => fetchOverview(),
    enabled: canSubscribers,
  });

  const growth = useQuery({
    queryKey: ["hq-platform-growth"],
    queryFn: () => fetchGrowth(),
    enabled: canSubscribers,
  });

  const siteVisits = useQuery({
    queryKey: ["hq-platform-site-visits"],
    queryFn: () => fetchSiteVisits(),
    enabled: canSubscribers,
  });

  const activity = useQuery({
    queryKey: ["hq-subscriber-activity", openId],
    queryFn: () => fetchActivity({ data: { userId: openId! } }),
    enabled: canSubscribers && !!openId,
  });

  const accountOverview = useQuery({
    queryKey: ["hq-subscriber-overview", openId],
    queryFn: () => fetchAccountOverview({ data: { userId: openId! } }),
    enabled: canSubscribers && !!openId,
  });

  const accounting = useQuery({
    queryKey: ["hq-platform-accounting"],
    queryFn: () => fetchAccounting(),
    enabled: canAccounting,
  });

  const subscribers = useMemo(() => {
    const rows = directory.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((s) =>
      [s.email, s.fullName, s.identityNumber, s.orgName, s.roles.join(",")]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [directory.data, search]);

  const toggleVip = useMutation({
    mutationFn: async (v: { userId: string; vip: boolean }) => {
      const { error } = await supabase.rpc("set_subscriber_vip", {
        _user_id: v.userId,
        _vip: v.vip,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hq-subscriber-directory"] }),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث علامة VIP")),
  });

  const setSuspended = useServerFn(hqSetAccountSuspended);
  const toggleSuspend = useMutation({
    mutationFn: (v: { userId: string; suspended: boolean }) => setSuspended({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.suspended ? "عُلِّق الحساب" : "رُفع التعليق عن الحساب");
      queryClient.invalidateQueries({ queryKey: ["hq-subscriber-directory"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث حالة الحساب")),
  });

  const setRole = useServerFn(hqSetAccountRole);
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: AppRole }) => setRole({ data: v }),
    onSuccess: () => {
      toast.success("تم تحديث الدور");
      queryClient.invalidateQueries({ queryKey: ["hq-subscriber-directory"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الدور")),
  });

  if (!me || (!isSuperAdmin && myHqPermissions.isPending)) return <Skeleton className="h-64" />;

  if (!hasAccess) {
    return (
      <>
        <PageHeader title="لوحة المدير العام" />
        <p className="text-sm text-muted-foreground">
          هذه الصفحة لمالك الموقع أو المدراء المفوَّضين فقط.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="لوحة المدير العام"
        subtitle="نظرة على المنصة كلها عبر كل المكاتب — دليل المشتركين وسجل نشاط كل واحد منهم وإحصاءات عامة."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          {canSubscribers ? <TabsTrigger value="subscribers">المشتركون</TabsTrigger> : null}
          {canSubscribers ? <TabsTrigger value="overview">نظرة عامة</TabsTrigger> : null}
          {canSubscribers ? <TabsTrigger value="audit">سجل التدقيق</TabsTrigger> : null}
          {canSubscribers ? <TabsTrigger value="direct-chat">شات عام</TabsTrigger> : null}
          {canAccounting ? <TabsTrigger value="accounting">المحاسبة</TabsTrigger> : null}
          {canCommissions ? <TabsTrigger value="commissions">عمولة الموقع</TabsTrigger> : null}
          {canReviews ? <TabsTrigger value="reviews">التقييمات والشكاوى</TabsTrigger> : null}
          {canOffices ? <TabsTrigger value="offices">المكاتب والسوق</TabsTrigger> : null}
          {canAnnouncements ? <TabsTrigger value="announcements">شات الإعلانات</TabsTrigger> : null}
          {canSystem ? <TabsTrigger value="system">النظام</TabsTrigger> : null}
          {isSuperAdmin ? <TabsTrigger value="admins">المدراء</TabsTrigger> : null}
        </TabsList>

        {isSuperAdmin ? (
          <TabsContent value="admins">
            <HqAdminsTab prefillEmail={hqInviteEmail} />
          </TabsContent>
        ) : null}

        {canAnnouncements ? (
          <TabsContent value="announcements">
            <AnnouncementsTab />
          </TabsContent>
        ) : null}

        {canOffices ? (
          <TabsContent value="offices">
            <HqOfficesPanel />
            <HqDemoRequests />
          </TabsContent>
        ) : null}

        {canSystem ? (
          <TabsContent value="system">
            <SystemTab isSuperAdmin={!!isSuperAdmin} />
          </TabsContent>
        ) : null}

        {canReviews ? (
          <TabsContent value="reviews">
            <ReviewsTab />
          </TabsContent>
        ) : null}

        {canCommissions ? (
          <TabsContent value="commissions">
            <CommissionsTab />
          </TabsContent>
        ) : null}

        {canAccounting ? (
          <TabsContent value="accounting">
            {accounting.isLoading ? (
              <Skeleton className="h-64" />
            ) : accounting.error ? (
              <p className="text-sm text-destructive">تعذّر تحميل بيانات المحاسبة.</p>
            ) : accounting.data ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                  <StatCard
                    icon={Wallet}
                    label="إجمالي المحصّل"
                    value={sar(accounting.data.totals.collected)}
                  />
                  <StatCard
                    icon={Wallet}
                    label="إجمالي المستحق"
                    value={sar(accounting.data.totals.outstanding)}
                  />
                  <StatCard
                    icon={Wallet}
                    label="إجمالي المصروفات"
                    value={sar(accounting.data.totals.expenses)}
                  />
                  <StatCard
                    icon={Wallet}
                    label="الصافي (محصّل − مصروفات)"
                    value={sar(accounting.data.totals.net)}
                  />
                  <StatCard
                    icon={Wallet}
                    label="إجمالي الفواتير المصدرة"
                    value={sar(accounting.data.totals.invoiced)}
                  />
                  <StatCard
                    icon={Wallet}
                    label="إجمالي الضريبة"
                    value={sar(accounting.data.totals.vat)}
                  />
                  <StatCard
                    icon={Handshake}
                    label="عمولات الصفقات (رابحة)"
                    value={sar(accounting.data.totals.commissions)}
                  />
                </div>

                <Card className="shadow-deed">
                  <CardHeader className="flex-row items-center justify-between gap-2">
                    <CardTitle className="text-base">حسب المكتب</CardTitle>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!accounting.data.byOffice.length}
                      onClick={() =>
                        exportWorkbook("محاسبة-المنصة.xlsx", [
                          {
                            name: "حسب المكتب",
                            rows: accounting.data.byOffice.map((o) => ({
                              المكتب: o.companyName || "",
                              محصّل: o.collected,
                              مستحق: o.outstanding,
                              مصروفات: o.expenses,
                              صافي: o.net,
                              فواتير: o.invoiced,
                              ضريبة: o.vat,
                              عمولات: o.commissions,
                            })),
                          },
                        ])
                      }
                    >
                      <Download className="size-4" />
                      تصدير Excel
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {accounting.data.byOffice.length === 0 ? (
                      <p className="text-sm text-muted-foreground">لا بيانات بعد.</p>
                    ) : (
                      accounting.data.byOffice.map((o) => (
                        <div
                          key={o.orgId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span className="font-medium">{o.companyName}</span>
                          <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <Badge variant="secondary">محصّل {sar(o.collected)}</Badge>
                            <Badge variant="secondary">مستحق {sar(o.outstanding)}</Badge>
                            <Badge variant="secondary">مصروفات {sar(o.expenses)}</Badge>
                            <Badge variant="secondary">صافي {sar(o.net)}</Badge>
                          </span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </TabsContent>
        ) : null}

        {canSubscribers ? (
          <TabsContent value="overview" className="space-y-6">
            {overview.isLoading ? (
              <Skeleton className="h-40" />
            ) : overview.error ? (
              <p className="text-sm text-destructive">تعذّر تحميل الإحصاءات.</p>
            ) : overview.data ? (
              <>
                {overview.data.unverifiedOffices > 0 || overview.data.openFeedback > 0 ? (
                  <Card className="border-warning/40 bg-warning/10 shadow-deed">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <TriangleAlert className="size-4 text-warning" />
                        يحتاج انتباهك
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2 text-sm">
                      {overview.data.unverifiedOffices > 0 ? (
                        <Badge variant="secondary">
                          {overview.data.unverifiedOffices} مكتب بانتظار التوثيق
                        </Badge>
                      ) : null}
                      {overview.data.openFeedback > 0 ? (
                        <Badge variant="secondary">
                          {overview.data.openFeedback} رسالة تقييم/شكوى بانتظار المراجعة
                        </Badge>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                  <StatCard
                    icon={Building2}
                    label="مكاتب مسجَّلة"
                    value={overview.data.totalOffices}
                  />
                  <StatCard icon={Store} label="إجمالي العروض" value={overview.data.totalUnits} />
                  <StatCard
                    icon={Store}
                    label="للإيجار / للبيع"
                    value={`${overview.data.rentUnits} / ${overview.data.saleUnits}`}
                  />
                  <StatCard icon={KeyRound} label="وحدات مباعة" value={overview.data.soldUnits} />
                  <StatCard
                    icon={Handshake}
                    label="عقود إيجار (سارية)"
                    value={`${overview.data.totalLeases} (${overview.data.activeLeases})`}
                  />
                  <StatCard
                    icon={Handshake}
                    label="إجمالي الصفقات"
                    value={overview.data.totalDeals}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {siteVisits.isLoading ? (
                    <>
                      <Skeleton className="h-28" />
                      <Skeleton className="h-28" />
                    </>
                  ) : siteVisits.error ? (
                    <p className="text-sm text-destructive sm:col-span-2">
                      تعذّر تحميل إحصاءات زوّار الموقع.
                    </p>
                  ) : siteVisits.data ? (
                    <>
                      <StatCard
                        icon={Eye}
                        label="زيارات الموقع"
                        value={siteVisits.data.totalVisits}
                        hint={`${siteVisits.data.visits30d} آخر 30 يومًا`}
                      />
                      <StatCard
                        icon={Users}
                        label="زوّار فريدون"
                        value={siteVisits.data.uniqueVisitors}
                        hint={`${siteVisits.data.uniqueVisitors30d} آخر 30 يومًا`}
                      />
                    </>
                  ) : null}
                </div>

                <Card className="shadow-deed">
                  <CardHeader>
                    <CardTitle className="text-base">النمو خلال آخر 6 أشهر</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {growth.isLoading ? (
                      <Skeleton className="h-64" />
                    ) : growth.error ? (
                      <p className="text-sm text-destructive">تعذّر تحميل بيانات النمو.</p>
                    ) : (
                      <ChartContainer config={GROWTH_CHART_CONFIG} className="h-64 w-full">
                        <BarChart data={growth.data ?? []}>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="month" tickLine={false} axisLine={false} />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="signups" fill="var(--color-signups)" radius={0} />
                          <Bar dataKey="offices" fill="var(--color-offices)" radius={0} />
                        </BarChart>
                      </ChartContainer>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : null}
          </TabsContent>
        ) : null}

        {canSubscribers ? (
          <TabsContent value="audit">
            <AuditLogTab />
          </TabsContent>
        ) : null}

        {canSubscribers ? (
          <TabsContent value="direct-chat">
            <HqDirectMessagesTab />
          </TabsContent>
        ) : null}

        {canSubscribers ? (
          <TabsContent value="subscribers">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative max-w-md flex-1">
                <Search className="absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground start-3" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث بالاسم أو البريد أو رقم الهوية/الرخصة أو المكتب…"
                  className="ps-9"
                />
              </div>
              <Button
                variant="outline"
                disabled={!directory.data?.length}
                onClick={() =>
                  exportWorkbook("مشتركو-جارك.xlsx", [
                    {
                      name: "المشتركون",
                      rows: (directory.data ?? []).map((s) => ({
                        الاسم: s.fullName || "",
                        البريد: s.email,
                        "الرقم التعريفي": s.referenceCode || "",
                        النوع: s.accountType
                          ? (roleLabel[s.accountType as AppRole] ?? s.accountType)
                          : "",
                        "رقم الهوية/الرخصة": s.identityNumber || "",
                        المكتب: s.orgName || "",
                        "انضم بتاريخ": s.createdAt,
                        عقارات: s.counts.properties,
                        إيجار: s.counts.rentals,
                        بيع: s.counts.sales,
                        VIP: s.isVip ? "نعم" : "لا",
                      })),
                    },
                  ])
                }
              >
                <Download className="size-4" />
                تصدير Excel
              </Button>
              <AddSubscriberDialog />
            </div>

            {directory.isLoading ? (
              <Skeleton className="h-64" />
            ) : directory.error ? (
              <p className="text-sm text-destructive">تعذّر تحميل دليل المشتركين.</p>
            ) : (
              <div className="space-y-3">
                {subscribers.map((s) => (
                  <Card key={s.id} className="shadow-deed">
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">
                            {s.fullName || "—"}{" "}
                            <span className="text-xs font-normal text-muted-foreground" dir="ltr">
                              {s.email}
                            </span>
                          </CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {s.referenceCode ? (
                              <span dir="ltr" className="font-mono tracking-wide">
                                #{s.referenceCode}
                              </span>
                            ) : null}
                            {s.referenceCode ? " · " : ""}
                            {s.accountType
                              ? (roleLabel[s.accountType as AppRole] ?? s.accountType)
                              : "—"}
                            {s.identityNumber ? <span dir="ltr"> · {s.identityNumber}</span> : ""}
                            {s.orgName ? ` · ${s.orgName}` : ""} · انضم {shortDate(s.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {s.roles.map((r) => (
                            <Badge key={r} variant="outline">
                              {roleLabel[r as AppRole] ?? r}
                            </Badge>
                          ))}
                          {s.roles.includes("admin") || s.roles.includes("super_admin") ? null : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={entering === s.id}
                                onClick={() => enterAccount(s.id)}
                              >
                                <LogIn className="size-4" />
                                {entering === s.id ? "جارٍ الدخول…" : "دخول حسابه"}
                              </Button>
                              <Button
                                size="sm"
                                variant={s.isSuspended ? "outline" : "destructive"}
                                disabled={toggleSuspend.isPending}
                                onClick={() => {
                                  if (
                                    s.isSuspended ||
                                    window.confirm("تعليق الحساب يمنعه من الدخول فورًا. متابعة؟")
                                  ) {
                                    toggleSuspend.mutate({
                                      userId: s.id,
                                      suspended: !s.isSuspended,
                                    });
                                  }
                                }}
                              >
                                <Ban className="size-4" />
                                {s.isSuspended ? "رفع التعليق" : "تعليق الحساب"}
                              </Button>
                            </>
                          )}
                          {s.roles.includes("super_admin") ? null : (
                            <Select
                              value={s.accountType ?? ""}
                              onValueChange={(role) => {
                                if (
                                  window.confirm(
                                    `تغيير دور ${s.fullName || s.email} إلى «${roleLabel[role as AppRole]}»؟`,
                                  )
                                ) {
                                  changeRole.mutate({ userId: s.id, role: role as AppRole });
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 w-32 text-xs">
                                <SelectValue placeholder="تغيير الدور" />
                              </SelectTrigger>
                              <SelectContent>
                                {HQ_ACCOUNT_ROLES.map((r) => (
                                  <SelectItem key={r} value={r}>
                                    {roleLabel[r]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {isSuperAdmin && !s.roles.includes("super_admin") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => inviteAsHqAdmin(s.email)}
                            >
                              <UserPlus className="size-4" />
                              دعوة كمدير عام
                            </Button>
                          ) : null}
                          {canReviews ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={s.isVip ? "إلغاء VIP" : "تحديد كـVIP"}
                              disabled={toggleVip.isPending}
                              onClick={() => toggleVip.mutate({ userId: s.id, vip: !s.isVip })}
                            >
                              <Star
                                className={cn(
                                  "size-4",
                                  s.isVip ? "fill-brass text-brass" : "text-muted-foreground",
                                )}
                              />
                            </Button>
                          ) : s.isVip ? (
                            <Star className="size-4 fill-brass text-brass" aria-label="VIP" />
                          ) : null}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="سجل النشاط"
                            onClick={() => setOpenId((v) => (v === s.id ? null : s.id))}
                          >
                            <ChevronDown className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{s.counts.properties} عقار</Badge>
                      <Badge variant="secondary">{s.counts.rentals} إيجار</Badge>
                      <Badge variant="secondary">{s.counts.sales} بيع</Badge>
                    </CardContent>

                    {openId === s.id ? (
                      <CardContent className="space-y-4 border-t border-border pt-4">
                        <div>
                          <p className="mb-2 text-sm font-medium">التفاصيل</p>
                          {accountOverview.isLoading ? (
                            <Skeleton className="h-32" />
                          ) : accountOverview.data ? (
                            <div className="grid gap-4 md:grid-cols-2">
                              <OverviewList
                                title="عقاراته"
                                rows={accountOverview.data.properties.map((p) => [
                                  p.name,
                                  [p.property_type, p.city, p.district].filter(Boolean).join(" — "),
                                ])}
                              />
                              <OverviewList
                                title="عقوده"
                                rows={accountOverview.data.leases.map((l) => [
                                  `${l.units?.properties?.name ?? ""} وحدة ${l.units?.unit_number ?? ""}`.trim(),
                                  `${l.status === "active" ? "ساري" : l.status} · ${Number(l.annual_rent).toLocaleString("ar-SA")} ر.س/سنة · حتى ${shortDate(l.end_date)}`,
                                ])}
                              />
                              <OverviewList
                                title="صيانته"
                                rows={accountOverview.data.maintenance.map((m) => [
                                  m.title,
                                  `${m.status} · ${m.priority}`,
                                ])}
                              />
                              <OverviewList
                                title="دفعات غير مسددة"
                                rows={accountOverview.data.unpaidPayments.map((p) => [
                                  `${Number(p.amount).toLocaleString("ar-SA")} ر.س`,
                                  `تستحق ${shortDate(p.due_date)} · ${p.status}`,
                                ])}
                              />
                              <OverviewList
                                title="صفقاته"
                                rows={accountOverview.data.deals.map((d) => [
                                  d.client_name,
                                  `${d.stage} · ${Number(d.value).toLocaleString("ar-SA")} ر.س`,
                                ])}
                              />
                            </div>
                          ) : null}
                        </div>

                        <div>
                          <p className="mb-2 text-sm font-medium">سجل النشاط</p>
                          {activity.isLoading ? (
                            <Skeleton className="h-32" />
                          ) : activity.data ? (
                            <div className="space-y-2">
                              {activity.data.map((r) => (
                                <div
                                  key={r.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs"
                                >
                                  <p>
                                    {actionLabel[r.action] ?? r.action} —{" "}
                                    {tableLabel[r.table_name] ?? r.table_name}
                                    {r.summary ? ` · ${summarize(r.summary, r.table_name)}` : ""}
                                  </p>
                                  <span className="text-muted-foreground">
                                    {new Date(r.created_at).toLocaleString("ar-SA")}
                                  </span>
                                </div>
                              ))}
                              {activity.data.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  لا نشاط مسجَّل لهذا الحساب.
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </CardContent>
                    ) : null}
                  </Card>
                ))}
                {subscribers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا نتائج مطابقة للبحث.</p>
                ) : null}
              </div>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}

type HqAdminInvite = { id: string; email: string; permissions: string[]; created_at: string };
type HqAdmin = {
  user_id: string;
  email: string;
  full_name: string | null;
  permissions: string[];
  created_at: string;
};

/** مالك الموقع فقط: يدعو أشخاصًا للوصول إلى /hq بصلاحيات قسم محددة، ويدير القائمة الحالية. */
function HqAdminsTab({ prefillEmail }: { prefillEmail?: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [permissions, setPermissions] = useState<Set<string>>(new Set(["subscribers"]));

  // Set (not merged) when a subscriber row's "دعوة كمدير عام" button jumps here, so the invite
  // form always starts from that account's email.
  useEffect(() => {
    if (prefillEmail) setEmail(prefillEmail);
  }, [prefillEmail]);

  const invitations = useQuery({
    queryKey: ["hq-admin-invitations"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("hq_admin_invitations");
      if (error) throw new Error(error.message);
      return (data ?? []) as HqAdminInvite[];
    },
  });

  const admins = useQuery({
    queryKey: ["hq-admins-list"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_hq_admins");
      if (error) throw new Error(error.message);
      return (data ?? []) as HqAdmin[];
    },
  });

  function togglePermission(p: string) {
    setPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  const invite = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("invite_hq_admin", {
        _email: email.trim(),
        _permissions: Array.from(permissions),
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("أُرسلت الدعوة");
      setEmail("");
      setPermissions(new Set(["subscribers"]));
      queryClient.invalidateQueries({ queryKey: ["hq-admin-invitations"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الدعوة")),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("revoke_hq_invitation", { _id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hq-admin-invitations"] }),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إلغاء الدعوة")),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("remove_hq_admin", { _user_id: userId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hq-admins-list"] }),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إزالة المدير")),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-4 text-brass" />
            دعوة مدير عام مفوَّض
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hq-invite-email">البريد الإلكتروني</Label>
            <Input
              id="hq-invite-email"
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>الصلاحيات</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {HQ_PERMISSION_OPTIONS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={permissions.has(p)}
                    onCheckedChange={() => togglePermission(p)}
                  />
                  {HQ_PERMISSION_LABEL[p]}
                  {UNENFORCED_HQ_PERMISSIONS.has(p) ? (
                    <Badge variant="outline" className="text-xs">
                      قريبًا
                    </Badge>
                  ) : null}
                </label>
              ))}
            </div>
          </div>
          <Button
            disabled={!email.trim() || permissions.size === 0 || invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending ? "جارٍ الإرسال..." : "إرسال الدعوة"}
          </Button>

          {invitations.data && invitations.data.length > 0 ? (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">دعوات معلّقة</p>
              {invitations.data.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span dir="ltr">{inv.email}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {inv.permissions.map((p) => HQ_PERMISSION_LABEL[p] ?? p).join("، ")}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="إلغاء الدعوة"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(inv.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">المدراء الحاليون</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {admins.isLoading ? (
            <Skeleton className="h-32" />
          ) : (admins.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا يوجد مدراء مفوَّضون بعد.</p>
          ) : (
            admins.data!.map((a) => (
              <div
                key={a.user_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {a.full_name || "—"}{" "}
                    <span className="text-xs font-normal text-muted-foreground" dir="ltr">
                      {a.email}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.permissions.map((p) => HQ_PERMISSION_LABEL[p] ?? p).join("، ")}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="إزالة المدير"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a.user_id)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** زر + نافذة "إضافة مشترك": ينشئ حساب مالك/مستأجر مباشرة ببريد وكلمة مرور يحددهما المدير العام
 * نفسه، بدل انتظار تسجيل الحساب لنفسه. staff/admin غير متاحين هنا عمدًا — راجع تعليق
 * hqCreateSubscriberAccount بـsuper-admin.functions.ts. */
function AddSubscriberDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"owner" | "tenant">("tenant");

  const createAccount = useServerFn(hqCreateSubscriberAccount);
  const create = useMutation({
    mutationFn: () =>
      createAccount({
        data: {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          password,
          role,
        },
      }),
    onSuccess: () => {
      toast.success("أُنشئ الحساب");
      setOpen(false);
      setFullName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setRole("tenant");
      queryClient.invalidateQueries({ queryKey: ["hq-subscriber-directory"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إنشاء الحساب")),
  });

  const canSubmit =
    fullName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(email) &&
    phone.trim().length >= 6 &&
    password.length >= 6 &&
    !create.isPending;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        إضافة مشترك
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">إضافة مشترك</DialogTitle>
            <DialogDescription>
              يُنشأ الحساب فورًا بهذه البيانات — يقدر المشترك يدخل مباشرة بالبريد وكلمة المرور دون
              انتظار تسجيله بنفسه.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-sub-name">الاسم الكامل</Label>
              <Input
                id="new-sub-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-sub-email">البريد الإلكتروني</Label>
              <Input
                id="new-sub-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-sub-phone">رقم الجوال</Label>
              <Input
                id="new-sub-phone"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-sub-password">كلمة المرور</Label>
              <Input
                id="new-sub-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>نوع الحساب</Label>
              <Select value={role} onValueChange={(v) => setRole(v as "owner" | "tenant")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">{roleLabel.tenant}</SelectItem>
                  <SelectItem value="owner">{roleLabel.owner}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={!canSubmit} onClick={() => create.mutate()}>
              {create.isPending ? "جارٍ الإنشاء..." : "إنشاء الحساب"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** شات عام: نفس مكوّن /messages → "محادثات مباشرة" حرفيًا (DirectMessagesTab مشترك) — المدير العام
 * يبدأ محادثة ثنائية مع أي حساب مسجَّل بالمنصة برقمه التعريفي المكوّن من 6 أرقام. my_direct_conversations/
 * start_direct_conversation لا قيد صلاحية داخلهما أصلًا، فالتبويب هنا يتقيّد فقط بصلاحية "subscribers". */
function HqDirectMessagesTab() {
  const [selected, setSelected] = useState<string | null>(null);
  const myName = useQuery({
    queryKey: ["my-profile-name"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", auth.user.id)
        .maybeSingle();
      return data?.full_name ?? auth.user.email ?? "مشارك";
    },
  });

  return (
    <DirectMessagesTab myName={myName.data ?? "مشارك"} selected={selected} onSelect={setSelected} />
  );
}

/** شات الإعلانات: بث باتجاه واحد لا محادثة — كل رسالة تُرسَل تصل كإشعار داخل الموقع لكل المستأجرين
 * والملاك عبر كل المكاتب دفعة واحدة. سجل الإرسال يُعرض بشكل فقاعات محادثة (نفس أسلوب DirectChat)
 * حتى يبقى واضحًا إنه بث جماعي، لا محادثة ثنائية قابلة للرد. */
function AnnouncementsTab() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const fetchAnnouncements = useServerFn(platformAnnouncements);
  const sendAnnouncement = useServerFn(sendPlatformAnnouncement);

  const history = useQuery({
    queryKey: ["hq-platform-announcements"],
    queryFn: () => fetchAnnouncements(),
  });

  const ordered = [...(history.data ?? [])].reverse();

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [ordered.length]);

  const send = useMutation({
    mutationFn: () => sendAnnouncement({ data: { title: title.trim(), body: body.trim() } }),
    onSuccess: (announcement) => {
      toast.success(`أُرسل الإعلان لـ${announcement.recipient_count} مستأجر/مالك`);
      setTitle("");
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["hq-platform-announcements"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر إرسال الإعلان")),
  });

  const canSend = title.trim().length > 0 && body.trim().length > 0 && !send.isPending;

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-brass" />
          شات الإعلانات
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="min-h-[14rem] max-h-[28rem] flex-1 space-y-3 overflow-y-auto rounded-md border border-border bg-muted/40 p-3">
          {history.isLoading ? (
            <Skeleton className="h-24" />
          ) : ordered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا إعلانات مُرسَلة بعد — أول إعلان تكتبه يصل فورًا لكل المستأجرين والملاك بالمنصة.
            </p>
          ) : (
            ordered.map((a) => (
              <div key={a.id} className="flex justify-start">
                <div className="max-w-[85%] rounded-lg bg-foreground px-3 py-2 text-sm text-background">
                  <div className="mb-1 flex items-center gap-2 text-xs opacity-80">
                    <span dir="ltr">
                      {new Date(a.created_at).toLocaleString("ar-SA", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                    <span>· وصل لـ{a.recipient_count} مستأجر/مالك</span>
                  </div>
                  <p className="font-medium">{a.title}</p>
                  <p className="whitespace-pre-wrap">{a.body}</p>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="space-y-2">
          <Input
            placeholder="عنوان الإعلان"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              placeholder="نص الإعلان..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <Button
              disabled={!canSend}
              onClick={() => {
                if (
                  window.confirm(
                    "سيصل هذا الإعلان فورًا لكل المستأجرين والملاك المسجَّلين بالمنصة. إرسال؟",
                  )
                ) {
                  send.mutate();
                }
              }}
            >
              <Send className="size-4" />
              {send.isPending ? "جارٍ الإرسال..." : "إرسال"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** عمولة الموقع (المرحلة 4): سجل يدوي بحت — لا بوابة دفع، تُسجَّل الصفقات/العقود التي جاب الموقع
 * طرفها يدويًا، وتُحدَّد كمحصَّلة لاحقًا. */
function CommissionsTab() {
  const queryClient = useQueryClient();
  const [orgId, setOrgId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const fetchCommissions = useServerFn(platformCommissions);
  const addCommission = useServerFn(addPlatformCommission);
  const markCollected = useServerFn(markCommissionCollected);

  const data = useQuery({
    queryKey: ["hq-platform-commissions"],
    queryFn: () => fetchCommissions(),
  });

  const add = useMutation({
    mutationFn: () =>
      addCommission({
        data: { orgId, description: description.trim(), amount: Number(amount) },
      }),
    onSuccess: () => {
      toast.success("سُجِّلت العمولة");
      setDescription("");
      setAmount("");
      queryClient.invalidateQueries({ queryKey: ["hq-platform-commissions"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تسجيل العمولة")),
  });

  const collect = useMutation({
    mutationFn: (id: string) => markCollected({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hq-platform-commissions"] }),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الحالة")),
  });

  const offices = data.data?.offices ?? [];
  const canSubmit = !!orgId && description.trim().length > 0 && Number(amount) > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          icon={Banknote}
          label="عمولة معلّقة"
          value={sar(data.data?.totals.pending ?? 0)}
        />
        <StatCard
          icon={Banknote}
          label="عمولة محصَّلة"
          value={sar(data.data?.totals.collected ?? 0)}
        />
      </div>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">تسجيل عمولة جديدة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>المكتب</Label>
              <Select value={orgId} onValueChange={setOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر مكتبًا" />
                </SelectTrigger>
                <SelectContent>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="commission-desc">الوصف</Label>
              <Input
                id="commission-desc"
                placeholder="مثال: صفقة بيع الوحدة X — طلب وصل عبر سوق العروض"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commission-amount">المبلغ (ر.س)</Label>
              <Input
                id="commission-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <Button disabled={!canSubmit || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? "جارٍ الحفظ..." : "تسجيل"}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">السجل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.isLoading ? (
            <Skeleton className="h-32" />
          ) : (data.data?.records ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا عمولات مسجَّلة بعد.</p>
          ) : (
            data.data!.records.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {r.orgName} <span className="text-muted-foreground">— {r.description}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sar(r.amount)} · {shortDate(r.created_at)}
                  </p>
                </div>
                {r.status === "collected" ? (
                  <Badge variant="secondary">محصَّلة</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={collect.isPending}
                    onClick={() => collect.mutate(r.id)}
                  >
                    تحديد كمحصَّلة
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const FEEDBACK_CATEGORY_LABEL: Record<string, string> = {
  rating: "تقييم",
  suggestion: "اقتراح",
  complaint: "شكوى",
};

/** المرحلة 5: تقييمات/اقتراحات/شكاوى وصلت من خانة "المساعدة" بأي لوحة تحكم. */
const AUDIT_ACTION_OPTIONS = ["INSERT", "UPDATE", "DELETE", "IMPERSONATE"];
const AUDIT_TABLE_OPTIONS = Object.keys(tableLabel);

function AuditLogTab() {
  const [action, setAction] = useState<string>("");
  const [tableName, setTableName] = useState<string>("");
  const [search, setSearch] = useState("");

  const fetchLog = useServerFn(platformAuditLog);
  const log = useQuery({
    queryKey: ["hq-platform-audit-log", action, tableName],
    queryFn: () =>
      fetchLog({
        data: {
          ...(action ? { action } : {}),
          ...(tableName ? { tableName } : {}),
        },
      }),
  });

  const rows = useMemo(() => {
    const all = log.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      [r.actorName, r.orgName, r.table_name, r.action].join(" ").toLowerCase().includes(q),
    );
  }, [log.data, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground start-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالفاعل أو المكتب…"
            className="ps-9"
          />
        </div>
        <Select
          value={tableName || "all"}
          onValueChange={(v) => setTableName(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="كل الجداول" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الجداول</SelectItem>
            {AUDIT_TABLE_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>
                {tableLabel[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action || "all"} onValueChange={(v) => setAction(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="كل الإجراءات" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الإجراءات</SelectItem>
            {AUDIT_ACTION_OPTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {actionLabel[a] ?? a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="shadow-deed">
        <CardContent className="space-y-2 pt-4">
          {log.isLoading ? (
            <Skeleton className="h-64" />
          ) : log.error ? (
            <p className="text-sm text-destructive">تعذّر تحميل سجل التدقيق.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا نشاط مطابق.</p>
          ) : (
            rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
              >
                <p>
                  {actionLabel[r.action] ?? r.action} — {tableLabel[r.table_name] ?? r.table_name}
                  {r.summary ? ` · ${summarize(r.summary, r.table_name)}` : ""}
                  <span className="text-muted-foreground">
                    {" "}
                    · {r.actorName || "—"}
                    {r.orgName ? ` (${r.orgName})` : ""}
                  </span>
                </p>
                <span className="text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("ar-SA")}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SystemTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const fetchSettings = useServerFn(platformSettings);
  const updateSettings = useServerFn(hqUpdatePlatformSettings);
  const fetchHealth = useServerFn(platformSystemHealth);

  const settings = useQuery({
    queryKey: ["hq-platform-settings"],
    queryFn: () => fetchSettings(),
  });
  const health = useQuery({
    queryKey: ["hq-platform-system-health"],
    queryFn: () => fetchHealth(),
  });

  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  // Local edits win until saved — otherwise every background refetch would stomp what's being typed.
  const registrationValue =
    registrationEnabled ?? settings.data?.new_office_registration_enabled ?? true;
  const bannerValue = banner ?? settings.data?.announcement_banner ?? "";

  const save = useMutation({
    mutationFn: () =>
      updateSettings({
        data: {
          newOfficeRegistrationEnabled: registrationValue,
          announcementBanner: bannerValue.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("حُفظت إعدادات المنصة");
      setRegistrationEnabled(null);
      setBanner(null);
      settings.refetch();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحفظ")),
  });

  return (
    <div className="space-y-6">
      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">إعدادات المنصة العامة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="reg-enabled"
                  checked={registrationValue}
                  onCheckedChange={(v) => setRegistrationEnabled(v === true)}
                />
                <Label htmlFor="reg-enabled">السماح بتسجيل مكاتب جديدة</Label>
              </div>
              <div className="space-y-1">
                <Label htmlFor="banner">
                  بانر إعلان عام (اختياري — يظهر لكل حساب مسجَّل دخوله)
                </Label>
                <Textarea
                  id="banner"
                  value={bannerValue}
                  onChange={(e) => setBanner(e.target.value)}
                  maxLength={500}
                  placeholder="مثال: صيانة مجدولة يوم الخميس من 2 إلى 4 فجرًا…"
                />
              </div>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">صحة المهام المجدولة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {health.isLoading ? (
            <Skeleton className="h-24" />
          ) : health.error ? (
            <p className="text-sm text-destructive">تعذّر تحميل حالة المهام.</p>
          ) : (
            health.data!.cronJobs.map((j) => (
              <div
                key={j.jobName}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{j.label}</span>
                {j.lastRun ? (
                  <span className="text-xs text-muted-foreground">
                    آخر تشغيل {new Date(j.lastRun.ran_at).toLocaleString("ar-SA")} · تأثّر{" "}
                    {j.lastRun.rows_affected ?? 0}
                  </span>
                ) : (
                  <Badge variant="secondary">لا سجل تشغيل بعد</Badge>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">صحة SEO</CardTitle>
          <p className="text-xs text-muted-foreground">
            ثغرات جاهزية بيانات تؤثر على جودة الظهور بمحركات البحث ومعاينات المشاركة.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          {health.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : health.data ? (
            <>
              <Badge variant="secondary">
                {health.data.seo.listingsMissingPhotos} / {health.data.seo.totalListings} عرضًا بلا
                صور
              </Badge>
              <Badge variant="secondary">
                {health.data.seo.listingsMissingDescription} عرضًا بلا وصف
              </Badge>
              <Badge variant="secondary">
                {health.data.seo.listingsMissingArea} عرضًا بلا مساحة
              </Badge>
              <Badge variant="secondary">
                {health.data.seo.ownerPagesMissingBio} / {health.data.seo.totalOwnerPages} صفحة مالك
                بلا نبذة
              </Badge>
              <Badge variant="secondary">
                {health.data.seo.ownerPagesMissingAvatar} صفحة مالك بلا صورة
              </Badge>
            </>
          ) : null}
        </CardContent>
      </Card>

      {isSuperAdmin ? <LegalPagesEditor /> : null}
    </div>
  );
}

type LegalPage = { slug: string; title: string; body: string };

/** تعديل الشروط وسياسة الخصوصية — لمالك الموقع فقط، لحساسية المحتوى القانوني. */
function LegalPagesEditor() {
  const [slug, setSlug] = useState<"terms" | "privacy">("terms");
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);

  const pages = useQuery({
    queryKey: ["hq-legal-pages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("legal_pages").select("slug, title, body");
      if (error) throw new Error(error.message);
      return (data ?? []) as LegalPage[];
    },
  });

  const current = pages.data?.find((p) => p.slug === slug) ?? null;
  const titleValue = title ?? current?.title ?? "";
  const bodyValue = body ?? current?.body ?? "";

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_legal_page", {
        _slug: slug,
        _title: titleValue,
        _body: bodyValue,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("حُفظت الصفحة");
      setTitle(null);
      setBody(null);
      pages.refetch();
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر الحفظ")),
  });

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="text-base">الصفحات القانونية</CardTitle>
        <p className="text-xs text-muted-foreground">
          نص مبدئي عام — يحتاج مراجعة قانونية قبل الاعتماد عليه فعليًا.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select
          value={slug}
          onValueChange={(v) => {
            setSlug(v as "terms" | "privacy");
            setTitle(null);
            setBody(null);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="terms">الشروط والأحكام</SelectItem>
            <SelectItem value="privacy">سياسة الخصوصية</SelectItem>
          </SelectContent>
        </Select>

        {pages.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="legal-title">العنوان</Label>
              <Input
                id="legal-title"
                value={titleValue}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="legal-body">المحتوى</Label>
              <Textarea
                id="legal-body"
                value={bodyValue}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-48"
              />
            </div>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "جارٍ الحفظ…" : "حفظ الصفحة"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const FEEDBACK_STATUS_LABEL: Record<string, string> = {
  open: "مفتوحة",
  in_progress: "قيد المعالجة",
  resolved: "محلولة",
};

function ReviewsTab() {
  const queryClient = useQueryClient();
  const fetchFeedback = useServerFn(platformFeedback);
  const setStatus = useServerFn(updateFeedbackStatus);

  const data = useQuery({
    queryKey: ["hq-platform-feedback"],
    queryFn: () => fetchFeedback(),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; status: "open" | "in_progress" | "resolved" }) =>
      setStatus({ data: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hq-platform-feedback"] }),
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر التحديث")),
  });

  const rows = data.data ?? [];
  const ratings = rows.filter((r) => r.category === "rating" && r.rating !== null);
  const avgRating = ratings.length
    ? ratings.reduce((s, r) => s + (r.rating ?? 0), 0) / ratings.length
    : null;
  const openCount = rows.filter((r) => r.status === "open").length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatCard
          icon={Star}
          label="متوسط تقييم الموقع"
          value={avgRating ? `${avgRating.toFixed(1)} / 5` : "—"}
        />
        <StatCard icon={MessageSquareWarning} label="بانتظار المراجعة" value={openCount} />
      </div>

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">الرسائل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.isLoading ? (
            <Skeleton className="h-32" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا رسائل بعد.</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {FEEDBACK_CATEGORY_LABEL[r.category] ?? r.category}
                    </Badge>
                    {r.rating ? (
                      <span className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star
                            key={i}
                            className={cn(
                              "size-3.5",
                              i < (r.rating ?? 0)
                                ? "fill-brass text-brass"
                                : "text-muted-foreground",
                            )}
                          />
                        ))}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {r.fullName || "مستخدم"} · {shortDate(r.created_at)}
                    </span>
                  </div>
                  <Select
                    value={r.status}
                    onValueChange={(v) =>
                      review.mutate({
                        id: r.id,
                        status: v as "open" | "in_progress" | "resolved",
                      })
                    }
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(FEEDBACK_STATUS_LABEL).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{r.message}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** نسخة من نفس المكوّن بـ`admin.tsx` القديمة (المحذوفة الآن) — يعرض عنوان + صفوف (سطر رئيسي وفرعي). */
function OverviewList({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">لا يوجد.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(([a, b], i) => (
            <li key={i} className="rounded-md border border-border p-2 text-xs">
              <p className="font-medium">{a}</p>
              <p className="text-muted-foreground">{b}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
