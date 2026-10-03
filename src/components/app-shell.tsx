import jarakLogo from "@/assets/jarak-logo.png";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  Gauge,
  Users,
  Wallet,
  Wrench,
  Handshake,
  Receipt,
  MessageCircle,
  MessageSquare,
  Bell,
  LogOut,
  Menu,
  UserCircle,
  ShieldCheck,
  BadgeCheck,
  CalendarClock,
  FileBarChart,
  FileText,
  MessagesSquare,
  PieChart,
  MapPin,
  ClipboardList,
  ScrollText,
  Undo2,
  Store,
  Contact,
  UserCog,
  Hourglass,
  ClipboardCheck,
  FileSignature,
  Landmark,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { platformSettings } from "@/lib/super-admin.functions";
import { InvitationsBanner } from "@/components/invitations-banner";
import { FeedbackWidget } from "@/components/feedback-widget";
import { Button } from "@/components/ui/button";
import { myOrgId } from "@/lib/use-org-branding";
import { useMyRoles, isStaffRole } from "@/lib/use-role";
import { todayRiyadh } from "@/lib/dates";
import { cn } from "@/lib/utils";

const staffNav = [
  { to: "/dashboard", label: "لوحة المؤشرات", icon: Gauge },
  { to: "/", label: "سوق العروض", icon: Store },
  { to: "/office-stats", label: "إحصاءات المكتب", icon: PieChart },
  { to: "/properties", label: "الأملاك والوحدات", icon: Building2 },
  { to: "/owner-pages", label: "صفحات الملاك", icon: Contact },
  { to: "/office-team", label: "فريق المكتب", icon: UserCog },
  { to: "/agreements", label: "اتفاقيات الإدارة", icon: FileSignature },
  { to: "/settings", label: "هوية المكتب", icon: BadgeCheck },
  { to: "/map", label: "خريطة الإشغال", icon: MapPin },
  { to: "/tenants", label: "المستأجرون والعقود", icon: Users },
  { to: "/renewals", label: "تجديد العقود", icon: CalendarClock },
  { to: "/collections", label: "التحصيل والمصروفات", icon: Wallet },
  { to: "/invoices", label: "الفواتير الإلكترونية", icon: Receipt },
  { to: "/maintenance", label: "الصيانة", icon: Wrench },
  { to: "/deals", label: "المبيعات والصفقات", icon: Handshake },
  { to: "/requests", label: "طلبات الوحدات", icon: ClipboardList },
  { to: "/reports", label: "التقارير الشهرية", icon: FileBarChart },
  { to: "/audit", label: "سجل التدقيق", icon: ScrollText },
  { to: "/documents", label: "وثائق العقارات", icon: FileText },
  { to: "/messages", label: "المحادثات", icon: MessagesSquare },
  { to: "/whatsapp", label: "مساعد واتساب", icon: MessageSquare },
  { to: "/notifications", label: "الإشعارات", icon: Bell },
  { to: "/assistant", label: "المساعد الذكي", icon: MessageCircle },
] as const;

const portalNav = [
  { to: "/portal", label: "صفحتي", icon: UserCircle },
  { to: "/", label: "سوق العروض", icon: Store },
  { to: "/messages", label: "المحادثات", icon: MessagesSquare },
  { to: "/documents", label: "وثائق عقاراتي", icon: FileText },
  { to: "/notifications", label: "الإشعارات", icon: Bell },
  { to: "/assistant", label: "المساعد الذكي", icon: MessageCircle },
  { to: "/register-office", label: "سجّل مكتبك", icon: Building2 },
] as const;

const adminNav = [{ to: "/users", label: "المستخدمون والأدوار", icon: ShieldCheck }] as const;

// دور super_admin منفصل تمامًا عن admin — لا يظهر لمدير مكتب عادي، فقط لحساب المدير العام.
const superAdminNav = [{ to: "/hq", label: "لوحة المدير العام", icon: Landmark }] as const;

// المستأجر له قائمة خاصة فيه، مو قائمة المكتب أو "portalNav" العامة (spec: tenant-dashboard-prompt.md).
// "عقدي" مو مسار مستقل — هو نفس قسم "كرت العقد" في لوحة المستأجر، فما ضفناه هنا لتفادي تكرار
// نفس الوجهة بلابل مختلفة. عناصر فيها "#" ترجع لنفس صفحة اللوحة وتمرّر لقسمها. مو عبر <Link> من
// tanstack-router لأن الأقسام مو مسارات مسجّلة أصلًا — روابط <a> عادية تكفي هنا (صفحة واحدة، نقرات
// نادرة، ما يستاهل التعقيد).
const tenantNav = [
  { key: "home", label: "الرئيسية", icon: Gauge, href: "/tenant-dashboard" },
  {
    key: "payments",
    label: "الدفعات",
    icon: Wallet,
    href: "/tenant-dashboard#payments",
    badge: "overdue" as const,
  },
  { key: "maintenance", label: "الصيانة", icon: Wrench, href: "/tenant-dashboard#maintenance" },
  {
    key: "messages",
    label: "المحادثات",
    icon: MessagesSquare,
    href: "/messages",
    badge: "unread" as const,
  },
  { key: "documents", label: "المستندات", icon: FileText, href: "/documents" },
  { key: "settings", label: "الإعدادات", icon: UserCog, href: "/tenant/settings" },
];
// الشريط السفلي بالجوال: 5 أيقونات بالضبط حسب المواصفة — "الإعدادات" تبقى متاحة من القائمة
// الجانبية (زر الهامبرغر) فقط، مو من الشريط السفلي.
const tenantBottomNav = tenantNav.slice(0, 5);

// قائمة المالك (spec: owner-dashboard-prompt.md، قسم 3) — بنفس منطق قائمة المستأجر: عناصر
// "#" ترجع لنفس صفحة /owner-dashboard وتمرّر لقسمها، لأن كل الأقسام المذكورة موجودة فعليًا
// بنفس الصفحة (لا صفحات "المالية"/"التقارير" منفصلة موصوفة بأي تفاصيل غير الموجودة أصلًا).
// "المكاتب والاتفاقيات" مسار مستقل فعلي (/owner/agreements)، لا "#anchor" داخل owner-dashboard —
// خلافًا لبقية العناصر: هذا قسم 2 بالمواصفة (اتفاقية الإدارة)، كان مؤجَّلًا عمدًا (قرار مستخدم
// سابق)، وحجمه (تصفّح مكاتب، طلب اتفاقية، إدارة صلاحيات) يستاهل صفحة قائمة بذاتها لا قسمًا فرعيًا.
// "الموافقات" مختلفة: موجودة اليوم فعلاً (قسم "صيانة تنتظر موافقتك" لا يعتمد على نظام
// الاتفاقيات — موافقة المالك على تكلفة الصيانة مبنية على ملكية الوحدة مباشرة)، فعدّادها حقيقي.
// بلا شريط سفلي للجوال — المواصفة ما تطلبه صراحة لهذي البوابة (خلافًا للمستأجر).
const ownerNav = [
  { key: "home", label: "الرئيسية", icon: Gauge, href: "/owner-dashboard" },
  { key: "properties", label: "عقاراتي", icon: Building2, href: "/owner-dashboard#units" },
  {
    key: "approvals",
    label: "الموافقات",
    icon: ClipboardCheck,
    href: "/owner-dashboard#approvals",
    badge: "approvals" as const,
  },
  { key: "agreements", label: "المكاتب والاتفاقيات", icon: Handshake, href: "/owner/agreements" },
  { key: "finance", label: "المالية", icon: Wallet, href: "/owner-dashboard#finance" },
  { key: "reports", label: "التقارير", icon: FileBarChart, href: "/owner-dashboard#reports" },
  { key: "messages", label: "المحادثات", icon: MessagesSquare, href: "/messages" },
  { key: "settings", label: "الإعدادات", icon: UserCog, href: "/owner/settings" },
];

// Shared with hq.tsx's own impersonation flow (hqImpersonateStart) — that's the only place that
// sets this key today, so the global banner below is what lets a super_admin get back to /hq from
// any page the impersonated session navigates to, not just from /hq itself.
//
// localStorage, not sessionStorage: the Supabase session itself lives in origin-wide localStorage
// and is broadcast to every open tab, so an "enter account" click in one tab silently swaps the
// signed-in identity in every other tab too. A tab-scoped restore key would leave those other tabs
// impersonating with no banner and no way back short of a fresh login — this key needs the same
// cross-tab reach as the session it's meant to undo.
const RESTORE_KEY = "aqari-hq-restore";

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const platformTeamPage = pathname === "/hq";
  const [open, setOpen] = useState(false);
  const [canRestore, setCanRestore] = useState(false);
  const { data: me } = useMyRoles();
  const roles = me?.roles ?? [];
  const staff = isStaffRole(roles);
  const tenant = !staff && roles.includes("tenant");
  // A dual owner+tenant account gets the tenant nav (checked first) — an owner who is ALSO a
  // tenant still needs their tenant-side badges/bottom-nav; the owner-only nav below is for
  // accounts with no tenant role at all.
  const owner = !staff && !tenant && roles.includes("owner");
  // الاسم أعلى الشريط الجانبي/الهيدر يعكس دور الحساب بدل اسم المنصة العام — طلب من المستخدم.
  // حساب بلا دور محدد (فني، أو بدون دور بعد) يبقى على اسم المنصة.
  const brandLabel = platformTeamPage
    ? "إدارة جارك"
    : staff
      ? "مكتب"
      : tenant
        ? "مستأجر"
        : owner
          ? "مالك"
          : "جارك";

  const fetchPlatformSettings = useServerFn(platformSettings);
  const announcement = useQuery({
    queryKey: ["platform-announcement-banner"],
    staleTime: 5 * 60_000,
    queryFn: () => fetchPlatformSettings(),
  });

  const overdueCount = useQuery({
    queryKey: ["tenant-nav-overdue", me?.userId],
    enabled: tenant,
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .neq("status", "paid")
        .lt("due_date", todayRiyadh());
      return count ?? 0;
    },
  });
  const unreadCount = useQuery({
    queryKey: ["tenant-nav-unread", me?.userId],
    enabled: tenant,
    staleTime: 30_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("unit_messages")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
        .neq("sender_role", "tenant");
      return count ?? 0;
    },
  });
  const approvalsCount = useQuery({
    queryKey: ["owner-nav-approvals", me?.userId],
    enabled: owner,
    staleTime: 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("maintenance_requests")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending");
      return count ?? 0;
    },
  });
  const navBadge = (key: "overdue" | "unread" | "approvals") =>
    (key === "overdue"
      ? overdueCount.data
      : key === "unread"
        ? unreadCount.data
        : approvalsCount.data) ?? 0;

  // A newly registered office works fully in private but stays out of the public market until the
  // platform verifies it. Best effort: if this lookup fails the banner is simply not shown.
  const officeVerified = useQuery({
    queryKey: ["office-verified", me?.userId],
    enabled: staff,
    staleTime: 60_000,
    queryFn: async () => {
      const orgId = await myOrgId();
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("org_settings")
        .select("verified")
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data?.verified ?? null;
    },
  });

  // A delegated hq_admins row (not the super_admin role itself) also unlocks the /hq nav link —
  // read via the table's own self-read RLS policy, no RPC needed.
  const hqPermissions = useQuery({
    queryKey: ["hq-permissions", me?.userId],
    enabled: !!me?.userId && !roles.includes("super_admin"),
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("hq_admins")
        .select("permissions")
        .eq("user_id", me!.userId!)
        .maybeSingle();
      return data?.permissions ?? [];
    },
  });

  useEffect(() => {
    setCanRestore(pathname !== "/hq" && !!localStorage.getItem(RESTORE_KEY));
    // Cross-tab: another tab's "enter account" click swaps this tab's session too (shared
    // localStorage), so react to that immediately instead of waiting for this tab's own navigation.
    const onStorage = (e: StorageEvent) => {
      if (e.key === RESTORE_KEY) setCanRestore(pathname !== "/hq" && !!e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [pathname]);

  async function restoreAdminSession() {
    const raw = localStorage.getItem(RESTORE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { access_token: string; refresh_token: string };
      const { error } = await supabase.auth.setSession({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
      });
      if (error) throw error;
      await supabase.auth.refreshSession({ refresh_token: saved.refresh_token });
      localStorage.removeItem(RESTORE_KEY);
      queryClient.clear();
      navigate({ to: "/hq", replace: true });
    } catch {
      localStorage.removeItem(RESTORE_KEY);
    }
  }

  const nav = platformTeamPage
    ? [...superAdminNav]
    : [
        ...(staff ? staffNav : portalNav),
        ...(staff ? [{ to: "/portal", label: "صفحتي", icon: UserCircle }] : []),
        ...(roles.includes("admin") ? adminNav : []),
        ...(roles.includes("super_admin") || (hqPermissions.data?.length ?? 0) > 0
          ? superAdminNav
          : []),
      ];

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 end-0 z-40 w-64 shrink-0 flex-col justify-between bg-sidebar p-4 text-sidebar-foreground transition-transform lg:static lg:flex lg:translate-x-0",
          open ? "flex" : "hidden",
        )}
      >
        <div>
          <div className="flex items-center gap-2 px-2 py-3">
            <img
              src={jarakLogo}
              alt="جارك"
              width={40}
              height={40}
              className="size-10 bg-background p-1"
            />
            <span className="font-display text-lg font-bold">{brandLabel}</span>
          </div>
          <nav className="mt-4 space-y-1">
            {!platformTeamPage && (tenant || owner)
              ? (tenant ? tenantNav : ownerNav).map((item) => {
                  const active = !item.href.includes("#") && pathname === item.href;
                  const badgeCount = item.badge ? navBadge(item.badge) : 0;
                  return (
                    <a
                      key={item.key}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <item.icon className="size-4" />
                      <span className="flex-1">{item.label}</span>
                      {badgeCount > 0 ? (
                        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
                          {badgeCount}
                        </span>
                      ) : null}
                    </a>
                  );
                })
              : nav.map((item) => {
                  const active = pathname === item.to;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60",
                      )}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </Link>
                  );
                })}
          </nav>
        </div>
        <div className="space-y-1">
          <FeedbackWidget />
          <Button
            variant="ghost"
            onClick={signOut}
            className="justify-start text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <LogOut className="size-4" />
            خروج
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <InvitationsBanner />
        {announcement.data?.announcement_banner ? (
          <div className="border-b border-border bg-primary/10 px-4 py-2 text-center text-sm">
            {announcement.data.announcement_banner}
          </div>
        ) : null}
        {canRestore ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <span>أنت داخل حساب آخر بجلسة المدير العام — هل تريد العودة لحسابك؟</span>
            <Button size="sm" variant="outline" onClick={restoreAdminSession}>
              <Undo2 className="size-4" />
              العودة لحساب المدير العام
            </Button>
          </div>
        ) : null}
        {!platformTeamPage && staff && officeVerified.data === false ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-warning/15 px-4 py-2 text-sm">
            <Hourglass className="size-4 shrink-0" aria-hidden />
            <span>
              مكتبك بانتظار توثيق إدارة المنصة. تعمل كل أدواتك بشكل كامل، لكن عروض مكتبك لا تظهر في
              سوق العروض حتى يُوثَّق.
            </span>
          </div>
        ) : null}
        <header className="flex items-center gap-3 border-b border-border bg-card/70 px-4 py-3 backdrop-blur lg:hidden">
          <Button
            variant="outline"
            size="icon"
            aria-label="فتح القائمة"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu className="size-4" />
          </Button>
          <span className="font-display font-bold">{brandLabel}</span>
        </header>
        <main
          className={cn("mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10", tenant && "pb-24 lg:pb-10")}
        >
          {children}
        </main>
      </div>

      {!platformTeamPage && tenant ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card lg:hidden">
          {tenantBottomNav.map((item) => {
            const active = !item.href.includes("#") && pathname === item.href;
            const badgeCount = item.badge ? navBadge(item.badge) : 0;
            return (
              <a
                key={item.key}
                href={item.href}
                className={cn(
                  "relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px]",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <item.icon className="size-5" />
                {item.label}
                {badgeCount > 0 ? (
                  <span className="absolute right-4 top-1 min-w-4 rounded-full bg-destructive px-1 text-[9px] font-medium text-destructive-foreground">
                    {badgeCount}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold md:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="deed-rule mt-4" />
    </div>
  );
}
