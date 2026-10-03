import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireHqPermission, type ServerCtx } from "@/lib/server-context";
import { PAGE, fetchAllRows, listAllAuthUsers } from "@/lib/admin-shared";
import type { AuditRow } from "@/lib/audit-format";
import { bucketGrowth, lastNMonths } from "@/lib/platform-growth";

/**
 * دليل كل المشتركين عبر كل المكاتب (لا يقتصر على مكتب واحد كـ/admin): النوع والرقم المعرّف وعدد
 * عملياته. لحسابات المكتب (موظف/مدير مرتبط بمكتب) العدّادات هي إجمالي مكتبه؛ للمالك والمستأجر هي
 * ملكيته أو عقوده الشخصية. مستقل تمامًا عن adminDirectory — لا يُعدَّل أو يُستورد منها.
 */
export const subscriberDirectory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const users = await listAllAuthUsers(supabaseAdmin);

    const [roleRows, profileRows, orgMemberRows, orgRows, properties, units, leases, deals] =
      await Promise.all([
        fetchAllRows((from, to) =>
          supabaseAdmin.from("user_roles").select("user_id, role").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin
            .from("profiles")
            .select(
              "id, full_name, phone, national_id, fal_license_no, vip, suspended, reference_code",
            )
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("org_members").select("user_id, org_id, kind").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("org_settings").select("id, company_name").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("properties").select("id, owner_id, org_id").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin
            .from("units")
            .select("id, property_id, owner_id, listing_purpose, status")
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("leases").select("id, unit_id, tenants(user_id)").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("deals").select("id, org_id").range(from, to),
        ),
      ]);

    const orgNameOf = new Map(orgRows.map((o) => [o.id, o.company_name]));
    const propertyOrgOf = new Map(properties.map((p) => [p.id, p.org_id]));
    const unitOrgOf = new Map(
      units.map((u) => [u.id, u.property_id ? (propertyOrgOf.get(u.property_id) ?? null) : null]),
    );

    // كل الأرقام تُحسب مرة واحدة لكل مكتب بدل إعادة حسابها لكل موظف فيه.
    const orgTotals = new Map(
      orgRows.map((o) => [
        o.id,
        {
          properties: properties.filter((p) => p.org_id === o.id).length,
          leases: leases.filter((l) => unitOrgOf.get(l.unit_id) === o.id).length,
          deals: deals.filter((d) => d.org_id === o.id).length,
        },
      ]),
    );

    return users.map((u) => {
      const profile = profileRows.find((p) => p.id === u.id);
      const roles = roleRows.filter((r) => r.user_id === u.id).map((r) => r.role as string);
      const membership = orgMemberRows.find((m) => m.user_id === u.id && m.kind === "member");
      const orgTotal = membership ? orgTotals.get(membership.org_id) : undefined;
      const ownedUnits = units.filter((un) => un.owner_id === u.id);
      const tenantLeases = leases.filter((l) => (l.tenants?.user_id ?? null) === u.id);

      const counts = membership
        ? {
            properties: orgTotal?.properties ?? 0,
            rentals: orgTotal?.leases ?? 0,
            sales: orgTotal?.deals ?? 0,
          }
        : {
            properties: properties.filter((p) => p.owner_id === u.id).length,
            rentals:
              tenantLeases.length +
              ownedUnits.filter((un) => un.listing_purpose === "rent" && un.status === "occupied")
                .length,
            sales: ownedUnits.filter(
              (un) =>
                un.listing_purpose === "sale" && (un.status === "sold" || un.status === "vacant"),
            ).length,
          };

      return {
        id: u.id,
        email: u.email ?? "",
        fullName: profile?.full_name ?? "",
        phone: profile?.phone ?? "",
        accountType:
          ["super_admin", "admin", "staff", "owner", "technician", "tenant"].find((r) =>
            roles.includes(r),
          ) ?? null,
        identityNumber: profile?.fal_license_no || profile?.national_id || null,
        referenceCode: profile?.reference_code ?? null,
        createdAt: u.created_at,
        lastSignIn: u.last_sign_in_at,
        roles,
        orgId: membership?.org_id ?? null,
        orgName: membership ? (orgNameOf.get(membership.org_id) ?? null) : null,
        isVip: profile?.vip ?? false,
        isSuspended: profile?.suspended ?? false,
        counts,
      };
    });
  });

/** سجل نشاط مشترك واحد عبر كل المكاتب (بند "SEC") — يعيد استخدام audit_log الموجود أصلاً. */
export const subscriberActivityLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("audit_log")
      .select("*")
      .eq("actor_id", data.userId)
      .order("id", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as AuditRow[];
  });

/**
 * نظرة كاملة على حساب مشترك واحد: عقاراته وعقوده وصيانته ودفعاته غير المسددة وصفقاته — نسخة من
 * `accountOverview` بـ`admin-users.functions.ts` (كانت حصرية لـ`/admin`، المحذوفة الآن) بحارس
 * `requireHqPermission` بدل `requireAdmin`. تُستدعى من تبويب "المشتركون" بـ`/hq` جنب سجل النشاط.
 */
export const subscriberOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [propsRes, leasesRes, maintRes, dealsRes, paymentsRes] = await Promise.all([
      supabaseAdmin
        .from("properties")
        .select("id, name, property_type, city, district, created_at")
        .eq("owner_id", data.userId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("leases")
        .select(
          "id, status, start_date, end_date, annual_rent, deposit, deposit_status, units(unit_number, properties(name)), tenants!inner(user_id)",
        )
        .eq("tenants.user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(20),
      // Filtering on tenants.user_id needs the embed in the select, otherwise PostgREST rejects
      // the request and the whole overview throws.
      supabaseAdmin
        .from("maintenance_requests")
        .select(
          "id, title, status, priority, cost, created_at, technician_id, tenants!inner(user_id)",
        )
        .eq("tenants.user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("deals")
        .select("id, client_name, stage, value, commission, created_at")
        .eq("assigned_to", data.userId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("payments")
        .select("id, amount, due_date, status, leases!inner(tenants!inner(user_id))")
        .eq("leases.tenants.user_id", data.userId)
        .neq("status", "paid")
        .order("due_date")
        .limit(10),
    ]);

    if (leasesRes.error) throw leasesRes.error;
    if (maintRes.error) throw maintRes.error;

    return {
      properties: propsRes.data ?? [],
      leases: leasesRes.data ?? [],
      maintenance: maintRes.data ?? [],
      deals: dealsRes.data ?? [],
      unpaidPayments: paymentsRes.data ?? [],
    };
  });

/**
 * سجل تدقيق شامل عبر كل المكاتب، بفلاتر — خلافًا لـ`subscriberActivityLog` أعلاه المقيَّد بمشترك
 * واحد. تُرجع أيضًا اسم الفاعل ومكتبه (بدل `actor_id`/`org_id` الخام) لأن الشاشة تعرض صفوفًا
 * لفاعلين ومكاتب متعددين دفعة واحدة، لا فاعلًا واحدًا معروفًا مسبقًا كالشاشة أعلاه.
 */
export const platformAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId?: string; action?: string; tableName?: string }) =>
    z
      .object({
        orgId: z.string().uuid().optional(),
        action: z.string().max(40).optional(),
        tableName: z.string().max(60).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("audit_log")
      .select("*")
      .order("id", { ascending: false })
      .limit(300);
    if (data.orgId) query = query.eq("org_id", data.orgId);
    if (data.action) query = query.eq("action", data.action);
    if (data.tableName) query = query.eq("table_name", data.tableName);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const auditRows = (rows ?? []) as unknown as (AuditRow & { org_id: string | null })[];

    const [profileRows, orgRows] = await Promise.all([
      fetchAllRows((from, to) =>
        supabaseAdmin.from("profiles").select("id, full_name").range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabaseAdmin.from("org_settings").select("id, company_name").range(from, to),
      ),
    ]);
    const nameOf = new Map(profileRows.map((p) => [p.id, p.full_name]));
    const orgNameOf = new Map(orgRows.map((o) => [o.id, o.company_name]));

    return auditRows.map((r) => ({
      ...r,
      actorName: r.actor_id ? (nameOf.get(r.actor_id) ?? null) : null,
      orgName: r.org_id ? (orgNameOf.get(r.org_id) ?? null) : null,
    }));
  });

/**
 * دخول حساب مشترك (انتحال جلسة) من لوحة /hq — يشمل كل الحسابات عبر كل المكاتب، خلافًا لـ
 * `impersonateStart` بـ`admin-users.functions.ts` المقصور على مكتب واحد عبر `requireAdmin`. نفس
 * المنطق الأمني بالضبط (حظر الدخول على حساب مدير، تسجيل بسجل التدقيق، توليد رابط magiclink) — فقط
 * بوابة الصلاحية تختلف (`requireHqPermission` بدل `requireAdmin`)، والحظر يشمل `super_admin` أيضًا
 * لا `admin` فقط.
 */
export const hqImpersonateStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fail closed: if either lookup errors we must not assume the target isn't privileged. Checks
    // both user_roles (admin/super_admin) AND hq_admins — the two are independent (a delegated hq
    // admin's power comes from an hq_admins row, not user_roles), so a "subscribers"-only delegate
    // must not be able to impersonate a fellow delegate who holds a broader permission set.
    const [{ data: roleRows, error: rolesError }, { data: hqAdminRow, error: hqAdminError }] =
      await Promise.all([
        supabaseAdmin.from("user_roles").select("role").eq("user_id", data.userId),
        supabaseAdmin.from("hq_admins").select("user_id").eq("user_id", data.userId).maybeSingle(),
      ]);
    if (rolesError || hqAdminError) throw new Error("تعذّر التحقق من صلاحيات الحساب");
    if (
      (roleRows ?? []).some((r) => r.role === "admin" || r.role === "super_admin") ||
      hqAdminRow
    ) {
      throw new Error("لا يمكن الدخول لحساب مدير آخر");
    }

    const { data: u, error: userError } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (userError || !u.user?.email) throw new Error("هذا الحساب بلا بريد إلكتروني");

    // Same audit_log org attribution as impersonateStart — see its comment for why this matters.
    const { data: targetOrgRows } = await supabaseAdmin
      .from("org_members")
      .select("org_id, kind")
      .eq("user_id", data.userId);
    const targetOrgId =
      (targetOrgRows ?? []).find((r) => r.kind === "member")?.org_id ??
      (targetOrgRows ?? [])[0]?.org_id ??
      null;

    const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
      actor_id: ctx.userId,
      table_name: "auth.users",
      row_id: data.userId,
      action: "IMPERSONATE",
      summary: { target_email: u.user.email },
      org_id: targetOrgId,
    });
    if (auditError) {
      console.error("hq impersonate audit insert failed", auditError);
      throw new Error("تعذّر تسجيل عملية الدخول في سجل التدقيق");
    }

    const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: u.user.email,
    });
    if (linkError || !link?.properties?.email_otp) {
      throw new Error("تعذّر توليد رابط الدخول");
    }
    return { email: u.user.email, otp: link.properties.email_otp };
  });

/**
 * تعليق/رفع تعليق حساب مشترك من /hq — نفس حظر استهداف admin/super_admin وتسجيل audit_log بـ
 * hqImpersonateStart أعلاه (لا نفس الدالة، لكن نفس الأسلوب). الإنفاذ الفعلي عبر
 * `ban_duration` من Supabase Auth (يمنع دخولًا/تجديد جلسة جديدًا فورًا) — حدّ معروف موثَّق بملف
 * الترحيل: أي JWT صادر قبل التعليق يبقى صالحًا حتى انتهاء صلاحيته الطبيعية.
 */
export const hqSetAccountSuspended = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; suspended: boolean }) =>
    z.object({ userId: z.string().uuid(), suspended: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Same reasoning as hqImpersonateStart above: an hq_admins row is an independent source of
    // privilege from user_roles, so it must be checked too, not just admin/super_admin.
    const [{ data: roleRows, error: rolesError }, { data: hqAdminRow, error: hqAdminError }] =
      await Promise.all([
        supabaseAdmin.from("user_roles").select("role").eq("user_id", data.userId),
        supabaseAdmin.from("hq_admins").select("user_id").eq("user_id", data.userId).maybeSingle(),
      ]);
    if (rolesError || hqAdminError) throw new Error("تعذّر التحقق من صلاحيات الحساب");
    if (
      (roleRows ?? []).some((r) => r.role === "admin" || r.role === "super_admin") ||
      hqAdminRow
    ) {
      throw new Error("لا يمكن تعليق حساب مدير");
    }

    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.suspended ? "876000h" : "none",
    });
    if (banError) throw new Error(banError.message);

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        suspended: data.suspended,
        suspended_at: data.suspended ? new Date().toISOString() : null,
      })
      .eq("id", data.userId);
    if (profileError) throw new Error(profileError.message);

    const { data: targetOrgRows } = await supabaseAdmin
      .from("org_members")
      .select("org_id, kind")
      .eq("user_id", data.userId);
    const targetOrgId =
      (targetOrgRows ?? []).find((r) => r.kind === "member")?.org_id ??
      (targetOrgRows ?? [])[0]?.org_id ??
      null;

    const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
      actor_id: ctx.userId,
      table_name: "profiles",
      row_id: data.userId,
      action: data.suspended ? "SUSPEND" : "UNSUSPEND",
      org_id: targetOrgId,
    });
    if (auditError) {
      console.error("hq suspend audit insert failed", auditError);
      throw new Error("تعذّر تسجيل العملية بسجل التدقيق");
    }
  });

// "admin" (الدور الموروث القديم، منفصل تمامًا عن نظام hq_admins/super_admin) عمدًا خارج هذه القائمة:
// منحه من هنا كان يفتح تصعيد صلاحيات ذاتيًا — مفوَّض بصلاحية "subscribers" فقط يقدر يمنح نفسه
// "admin" (الفرع الوحيد اللي كان يتجاوز حارس "آخر مدير/استهداف الذات")، ثم يستخدمه عبر /users
// (requireAdmin) للوصول لكل حسابات المنصة بلا أي قيد عزل مكاتب. منح "admin" الآن ممكن فقط يدويًا
// بقاعدة البيانات أو عبر تسجيل أول حساب بالمنصة (assign_default_role).
const hqAccountRoleSchema = z.enum(["staff", "owner", "tenant", "technician"]);

/**
 * تغيير دور حساب من دليل المشتركين (/hq) — نفس منطق setAccountRole (src/lib/admin-users.functions.ts)
 * حرفيًا، بحارس requireHqPermission بدل requireAdmin؛ مستقل عنها تمامًا بنفس نمط الازدواج المتَّبع
 * أصلًا بهذا الكود (hqImpersonateStart/impersonateStart، hq_list_offices/admin_list_offices).
 * super_admin وhq_admins (مدير مفوَّض آخر) مستثنيان عمدًا: الأول يتجاوز عزل المكاتب بالكامل ولا يُمنح
 * إلا عبر ترحيل يدوي لمرة واحدة، والثاني لأن صلاحيته الحقيقية بجدول hq_admins مستقلة تمامًا عن
 * user_roles — لا يحق لمفوَّض "subscribers" فقط يلمس دور زميل مفوَّض بصلاحيات أوسع.
 */
export const hqSetAccountRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; role: string }) =>
    z.object({ userId: z.string().uuid(), role: hqAccountRoleSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      { data: currentRoles, error: currentRolesError },
      { data: hqAdminRow, error: hqAdminError },
    ] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", data.userId),
      supabaseAdmin.from("hq_admins").select("user_id").eq("user_id", data.userId).maybeSingle(),
    ]);
    if (currentRolesError || hqAdminError) throw new Error("تعذّر التحقق من دور الحساب");
    if ((currentRoles ?? []).some((r) => r.role === "super_admin") || hqAdminRow) {
      throw new Error("لا يمكن تغيير دور حساب مدير عام من هنا");
    }

    if (data.userId === ctx.userId) throw new Error("لا يمكنك تغيير دور حسابك أنت");
    const { data: admins, error: adminsError } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (adminsError) throw adminsError;
    const adminIds = new Set((admins ?? []).map((r) => r.user_id));
    if (adminIds.has(data.userId) && adminIds.size <= 1) {
      throw new Error("لا يمكن إزالة آخر مدير للنظام");
    }

    // Office employees are made by the office, through an invitation the account accepts: that is
    // what gives them an org_members row, and without one a "staff" account can see nothing.
    if (data.role === "staff" || data.role === "technician") {
      const { data: member, error: memberError } = await supabaseAdmin
        .from("org_members")
        .select("org_id")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (memberError) throw new Error("تعذّر التحقق من مكتب الحساب");
      if (!member) {
        throw new Error(
          "هذا الحساب ليس تابعًا لأي مكتب — يضيفه مدير المكتب من شاشة «فريق المكتب» ويقبل هو الدعوة",
        );
      }
    }

    // Add the new role first and only then drop the others, so a failure in between can never
    // leave the account with no role at all.
    const { error: addError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: data.userId, role: data.role },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (addError) throw addError;

    const { error: delError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .neq("role", data.role);
    if (delError) throw delError;

    // Demoting an employee to owner/tenant must also end their membership, or they keep their
    // office's rows through org_members while no longer being staff.
    if (data.role !== "staff" && data.role !== "technician") {
      const { error: leaveError } = await supabaseAdmin
        .from("org_members")
        .delete()
        .eq("user_id", data.userId);
      if (leaveError) throw new Error("تعذّر إنهاء عضوية الحساب في المكتب");
    }

    const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
      actor_id: ctx.userId,
      table_name: "user_roles",
      row_id: data.userId,
      action: "UPDATE",
      summary: { status: data.role },
    });
    if (auditError) console.error("hq role-change audit insert failed", auditError);

    return { ok: true };
  });

const hqNewSubscriberRoleSchema = z.enum(["owner", "tenant"]);

/**
 * إنشاء حساب مشترك (مالك/مستأجر) مباشرة من /hq ببريد وكلمة مرور، بدل انتظار تسجيله بنفسه.
 * staff/admin/technician مستثناة عمدًا: تمر عبر مسارها الصحيح (دعوة "فريق المكتب"/تسجيل مكتب) لأن
 * is_staff تتطلب صف org_members أولًا — نفس اشتراط hqSetAccountRole بالأعلى.
 * account_type بـuser_metadata هو نفس ما يرسله نموذج التسجيل الذاتي (src/routes/auth.tsx)؛
 * assign_default_role() (أحدث ترحيل) يقرأه ويمنح الدور المطابق مباشرة عبر on_auth_user_created —
 * نفس مسار أي حساب سجّل نفسه بنفسه حرفيًا، فلا حاجة لأي تصحيح دور يدوي بعد الإنشاء.
 */
export const hqCreateSubscriberAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { fullName: string; email: string; phone: string; password: string; role: string }) =>
      z
        .object({
          fullName: z.string().trim().min(1).max(200),
          email: z.string().trim().toLowerCase().email(),
          phone: z.string().trim().min(6).max(20),
          password: z.string().min(6),
          role: hqNewSubscriberRoleSchema,
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, phone: data.phone, account_type: data.role },
    });
    if (createError) throw new Error(createError.message);

    const { error: auditError } = await supabaseAdmin.from("audit_log").insert({
      actor_id: ctx.userId,
      table_name: "profiles",
      row_id: created.user.id,
      action: "INSERT",
      summary: { full_name: data.fullName, status: data.role },
    });
    if (auditError) console.error("hq create-account audit insert failed", auditError);

    return { id: created.user.id };
  });

/** نظرة عامة على إحصاءات المنصة كلها: عدد المكاتب والعروض وعقود الإيجار والصفقات. */
export const platformOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      offices,
      unverifiedOffices,
      totalUnits,
      rentUnits,
      saleUnits,
      soldUnits,
      totalLeases,
      activeLeases,
      totalDeals,
      openFeedback,
    ] = await Promise.all([
      supabaseAdmin.from("org_settings").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("org_settings")
        .select("id", { count: "exact", head: true })
        .eq("verified", false),
      supabaseAdmin.from("units").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("units")
        .select("id", { count: "exact", head: true })
        .eq("listing_purpose", "rent"),
      supabaseAdmin
        .from("units")
        .select("id", { count: "exact", head: true })
        .eq("listing_purpose", "sale"),
      supabaseAdmin.from("units").select("id", { count: "exact", head: true }).eq("status", "sold"),
      supabaseAdmin.from("leases").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("leases")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabaseAdmin.from("deals").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("platform_feedback")
        .select("id", { count: "exact", head: true })
        .eq("status", "open"),
    ]);

    return {
      totalOffices: offices.count ?? 0,
      unverifiedOffices: unverifiedOffices.count ?? 0,
      totalUnits: totalUnits.count ?? 0,
      rentUnits: rentUnits.count ?? 0,
      saleUnits: saleUnits.count ?? 0,
      soldUnits: soldUnits.count ?? 0,
      totalLeases: totalLeases.count ?? 0,
      activeLeases: activeLeases.count ?? 0,
      totalDeals: totalDeals.count ?? 0,
      openFeedback: openFeedback.count ?? 0,
    };
  });

/** تسجيلات المنصة (حسابات ومكاتب) لآخر 6 أشهر — للرسم البياني بتبويب "نظرة عامة". أعداد فقط
 * (لا صفوف مستخدمين خام) لتفادي تسريب بيانات لا يحتاجها الرسم البياني. */
export const platformGrowth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [users, offices] = await Promise.all([
      listAllAuthUsers(supabaseAdmin),
      fetchAllRows((from, to) =>
        supabaseAdmin.from("org_settings").select("created_at").range(from, to),
      ),
    ]);

    return bucketGrowth(users, offices, lastNMonths(6));
  });

/** عدد زيارات الموقع العام (الصفحة الرئيسية/الوحدات/المكاتب/الملاك/سوق الطلبات) — تجميع فعلي +
 * أشخاص فريدون (معرّف مجهول بالمتصفح)، إجمالي وآخر 30 يومًا. */
export const platformSiteVisits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "subscribers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin.rpc("site_visit_stats").single();
    if (error) throw new Error(error.message);
    return {
      totalVisits: Number(data.total_visits ?? 0),
      uniqueVisitors: Number(data.unique_visitors ?? 0),
      visits30d: Number(data.visits_30d ?? 0),
      uniqueVisitors30d: Number(data.unique_visitors_30d ?? 0),
    };
  });

/**
 * محاسبة المنصة كلها لكل مكتب: نفس تعريفات "المحصّل"/"المستحق"/"العمولات" الموجودة أصلًا بتقرير
 * كل مكتب (`reports.tsx`)، لكن مجمَّعة عبر كل المكاتب بدل مكتب واحد. `payments`/`invoices`/
 * `expenses` بلا `org_id` مباشر على القاعدة الحية — مكتبها يُشتق عبر property/unit/lease، نفس ما
 * يفعله `subscriberDirectory` أعلاه.
 */
export const platformAccounting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "accounting");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [orgRows, properties, units, leases, payments, expenses, invoices, deals] =
      await Promise.all([
        fetchAllRows((from, to) =>
          supabaseAdmin.from("org_settings").select("id, company_name").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("properties").select("id, org_id").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("units").select("id, property_id").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("leases").select("id, unit_id").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("payments").select("lease_id, amount, status").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("expenses").select("property_id, unit_id, amount").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("invoices").select("lease_id, total, vat_amount").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabaseAdmin.from("deals").select("org_id, stage, commission").range(from, to),
        ),
      ]);

    const propertyOrgOf = new Map(properties.map((p) => [p.id, p.org_id]));
    const unitOrgOf = new Map(
      units.map((u) => [u.id, u.property_id ? (propertyOrgOf.get(u.property_id) ?? null) : null]),
    );
    const leaseOrgOf = new Map(leases.map((l) => [l.id, unitOrgOf.get(l.unit_id) ?? null]));

    const zero = () => ({
      collected: 0,
      outstanding: 0,
      expenses: 0,
      invoiced: 0,
      vat: 0,
      commissions: 0,
    });
    const byOrg = new Map<string, ReturnType<typeof zero>>();
    const bucket = (orgId: string | null) => {
      if (!orgId) return null;
      if (!byOrg.has(orgId)) byOrg.set(orgId, zero());
      return byOrg.get(orgId)!;
    };

    for (const p of payments) {
      const b = bucket(leaseOrgOf.get(p.lease_id) ?? null);
      if (!b) continue;
      if (p.status === "paid") b.collected += Number(p.amount);
      else b.outstanding += Number(p.amount);
    }
    for (const e of expenses) {
      const orgId = e.property_id
        ? (propertyOrgOf.get(e.property_id) ?? null)
        : e.unit_id
          ? (unitOrgOf.get(e.unit_id) ?? null)
          : null;
      const b = bucket(orgId);
      if (b) b.expenses += Number(e.amount);
    }
    for (const i of invoices) {
      const b = bucket(i.lease_id ? (leaseOrgOf.get(i.lease_id) ?? null) : null);
      if (!b) continue;
      b.invoiced += Number(i.total);
      b.vat += Number(i.vat_amount ?? 0);
    }
    for (const d of deals) {
      if (d.stage !== "won") continue;
      const b = bucket(d.org_id);
      if (b) b.commissions += Number(d.commission);
    }

    const byOffice = orgRows
      .map((o) => {
        const b = byOrg.get(o.id) ?? zero();
        return { orgId: o.id, companyName: o.company_name, ...b, net: b.collected - b.expenses };
      })
      .sort((a, b) => b.collected - a.collected);

    const totals = byOffice.reduce(
      (acc, o) => ({
        collected: acc.collected + o.collected,
        outstanding: acc.outstanding + o.outstanding,
        expenses: acc.expenses + o.expenses,
        invoiced: acc.invoiced + o.invoiced,
        vat: acc.vat + o.vat,
        commissions: acc.commissions + o.commissions,
        net: acc.net + o.net,
      }),
      { collected: 0, outstanding: 0, expenses: 0, invoiced: 0, vat: 0, commissions: 0, net: 0 },
    );

    return { totals, byOffice };
  });

/** إعدادات المنصة العامة الحالية (قراءة عامة — بلا بيانات حساسة). */
export const platformSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("platform_settings")
    .select("new_office_registration_enabled, announcement_banner")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? { new_office_registration_enabled: true, announcement_banner: null };
});

/** تعديل إعدادات المنصة العامة — صلاحية "system" فقط. */
export const hqUpdatePlatformSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { newOfficeRegistrationEnabled: boolean; announcementBanner: string | null }) =>
      z
        .object({
          newOfficeRegistrationEnabled: z.boolean(),
          announcementBanner: z.string().max(500).nullable(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "system");
    const { error } = await ctx.supabase.rpc("hq_update_platform_settings", {
      _new_office_registration_enabled: data.newOfficeRegistrationEnabled,
      _announcement_banner: data.announcementBanner ?? "",
    });
    if (error) throw new Error(error.message);
  });

/**
 * صحة المهام المجدولة (pg_cron) وصحة SEO — كلها من بيانات موجودة أصلًا بلا أي API خارجي.
 * آخر تشغيل مسجَّل لكل مهمة (من cron_job_runs، تُكتب من داخل الدالتين المجدولتين نفسيهما)، وعدّ
 * ثغرات جاهزية بيانات العروض/صفحات الملاك (تؤثر مباشرة على جودة og:tags/JSON-LD المولَّدة منها).
 */
export const platformSystemHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "system");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [cronRuns, listings, ownerPages] = await Promise.all([
      fetchAllRows((from, to) =>
        supabaseAdmin
          .from("cron_job_runs")
          .select("job_name, ran_at, rows_affected")
          .order("ran_at", { ascending: false })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabaseAdmin
          .from("vacant_units_public")
          .select("id, photos_count, listing_description, area")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabaseAdmin
          .from("owner_pages_public")
          .select("owner_id, bio, avatar_path")
          .range(from, to),
      ),
    ]);

    const lastRunOf = (jobName: string) => cronRuns.find((r) => r.job_name === jobName) ?? null;

    return {
      cronJobs: [
        {
          jobName: "vacant-price-decay",
          label: "تخفيض سعر الشاغر",
          lastRun: lastRunOf("vacant-price-decay"),
        },
        {
          jobName: "smart-payment-reminders",
          label: "تذكير الدفعات الذكي",
          lastRun: lastRunOf("smart-payment-reminders"),
        },
      ],
      seo: {
        totalListings: listings.length,
        listingsMissingPhotos: listings.filter((l) => (l.photos_count ?? 0) === 0).length,
        listingsMissingDescription: listings.filter((l) => !l.listing_description).length,
        listingsMissingArea: listings.filter((l) => l.area == null).length,
        totalOwnerPages: ownerPages.length,
        ownerPagesMissingBio: ownerPages.filter((o) => !o.bio).length,
        ownerPagesMissingAvatar: ownerPages.filter((o) => !o.avatar_path).length,
      },
    };
  });

/**
 * عمولة الموقع (المرحلة 4): تتبّع ومحاسبة يدوية فقط — بلا بوابة دفع، حسب قرار المستخدم صراحة.
 * `platform_commissions` داخلي بالكامل (بلا سياسات RLS للعميل)، الوصول فقط من هنا عبر service-role.
 */
export const platformCommissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "commissions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [rows, orgRows] = await Promise.all([
      fetchAllRows((from, to) =>
        supabaseAdmin
          .from("platform_commissions")
          .select("id, org_id, description, amount, status, created_at, collected_at")
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabaseAdmin.from("org_settings").select("id, company_name").range(from, to),
      ),
    ]);

    const orgNameOf = new Map(orgRows.map((o) => [o.id, o.company_name]));
    const records = rows.map((r) => ({ ...r, orgName: orgNameOf.get(r.org_id) ?? "—" }));
    const totals = records.reduce(
      (acc, r) => {
        const amount = Number(r.amount);
        if (r.status === "collected") acc.collected += amount;
        else acc.pending += amount;
        return acc;
      },
      { pending: 0, collected: 0 },
    );

    return { records, totals, offices: orgRows };
  });

export const addPlatformCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orgId: string; description: string; amount: number }) =>
    z
      .object({
        orgId: z.string().uuid(),
        description: z.string().trim().min(1).max(500),
        amount: z.number().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "commissions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("platform_commissions").insert({
      org_id: data.orgId,
      description: data.description,
      amount: data.amount,
      created_by: ctx.userId,
    });
    if (error) throw new Error(error.message);
  });

export const markCommissionCollected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "commissions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("platform_commissions")
      .update({ status: "collected", collected_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
  });

/** سجل "شات الإعلانات" — أحدث ما بُثّ أولًا، لعرضه كمحادثة بلوحة /hq. */
export const platformAnnouncements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "announcements");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const rows = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from("platform_announcements")
        .select("id, title, body, recipient_count, created_at")
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    return rows;
  });

/**
 * بث إعلان نصي كإشعار داخل الموقع (notifications) لكل المستأجرين والملاك عبر كل المكاتب دفعة
 * واحدة — بث باتجاه واحد لا محادثة، والعميل يستقبله بصفحة /notifications الموجودة أصلًا.
 * user_roles تكفي وحدها لتحديد "كل مستأجر/مالك بالمنصة" (نفس ما تستخدمه subscriberDirectory) —
 * لا حاجة للمرور بـtenants/properties. الإرسال بدُفعات (PAGE لكل insert) حتى لا يتجاوز حجم الطلب
 * الواحد حدود PostgREST لو كبر عدد العملاء.
 */
export const sendPlatformAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { title: string; body: string }) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "announcements");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const roleRows = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .in("role", ["tenant", "owner"])
        .range(from, to),
    );
    const recipientIds = [...new Set(roleRows.map((r) => r.user_id))];

    const { data: announcement, error: insertError } = await supabaseAdmin
      .from("platform_announcements")
      .insert({
        title: data.title,
        body: data.body,
        created_by: ctx.userId,
        recipient_count: recipientIds.length,
      })
      .select("id, title, body, recipient_count, created_at")
      .single();
    if (insertError) throw new Error(insertError.message);

    for (let i = 0; i < recipientIds.length; i += PAGE) {
      const batch = recipientIds.slice(i, i + PAGE);
      const { error: notifyError } = await supabaseAdmin.from("notifications").insert(
        batch.map((id) => ({
          user_id: id,
          title: data.title,
          body: data.body,
          kind: "announcement",
          source: "hq",
          related_table: "platform_announcements",
          related_id: announcement.id,
        })),
      );
      if (notifyError) throw new Error(notifyError.message);
    }

    return announcement;
  });

/**
 * التقييمات/الاقتراحات/الشكاوى المرحلة 5: `platform_feedback` داخلي بالكامل (بلا أي سياسة RLS
 * لـauthenticated) — الكتابة فقط عبر `submit_feedback()` (RPC عام لأي حساب، بمعدّل محدود)، والقراءة
 * هنا فقط عبر service-role.
 */
export const platformFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "reviews");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [rows, profileRows] = await Promise.all([
      fetchAllRows((from, to) =>
        supabaseAdmin
          .from("platform_feedback")
          .select("id, user_id, category, rating, message, status, created_at")
          .order("created_at", { ascending: false })
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabaseAdmin.from("profiles").select("id, full_name").range(from, to),
      ),
    ]);

    const nameOf = new Map(profileRows.map((p) => [p.id, p.full_name]));
    return rows.map((r) => ({ ...r, fullName: nameOf.get(r.user_id) || null }));
  });

/** حالات التذكرة الثلاث (كانت ثنائية open/reviewed). */
export const updateFeedbackStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "open" | "in_progress" | "resolved" }) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["open", "in_progress", "resolved"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "reviews");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("platform_feedback")
      .update({
        status: data.status,
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
  });
