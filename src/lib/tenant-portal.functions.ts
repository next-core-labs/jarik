import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMyOrgId, requireStaff, type ServerCtx } from "@/lib/server-context";

// No APP_URL env var exists in this project yet (checked: only client-side window.location.origin
// is used anywhere for redirect links, which a server function has no access to). Set APP_URL in
// the environment for this to be correct across environments; this falls back to the known
// production domain otherwise.
const APP_URL = process.env["APP_URL"] ?? "https://yourneighbor.app";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

/** الموظف يدعو مستأجرًا على عقد بإيميله — يرسل دعوة Supabase الأصلية (نفس نظام بريد الرموز
 * المستخدَم أصلًا لتسجيل الدخول والتحقق، لا بنية بريد مخصّصة جديدة) وتُسجَّل الدعوة لإكمال ربط
 * tenants.user_id بعد قبولها. */
export const inviteTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leaseId: string; email: string }) =>
    z.object({ leaseId: z.string().uuid(), email: z.string().email() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);

    // RLS already scopes this to a lease the caller's own office can see.
    const { data: lease, error } = await ctx.supabase
      .from("leases")
      .select("id, tenant_id")
      .eq("id", data.leaseId)
      .maybeSingle();
    if (error || !lease) throw new Error("لم نجد هذا العقد");

    const orgId = await getMyOrgId(ctx);
    const email = data.email.toLowerCase().trim();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: inviteError } = await supabaseAdmin.from("tenant_invites").insert({
      lease_id: data.leaseId,
      org_id: orgId,
      email,
      created_by: ctx.userId,
    });
    if (inviteError) throw new Error("تعذّر إنشاء الدعوة");

    const { error: sendError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { account_type: "tenant" },
      redirectTo: `${APP_URL}/tenant/activate`,
    });
    if (
      sendError &&
      !/already registered|already exists|already been registered/i.test(sendError.message)
    ) {
      throw new Error("تعذّر إرسال دعوة البريد الإلكتروني");
    }
    // An email that already has an account is fine: the pending tenant_invites row we just wrote
    // is keyed by email, not by a fresh signup — they complete activation by signing in normally
    // and visiting /tenant/activate, which the accept flow already redirects to either way.
    return { ok: true };
  });

/** المستأجر المدعو، بعد قبول الدعوة والدخول، يكمل ربط حسابه بسجل tenants الخاص بعقده. */
export const completeTenantActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authUser, error: userError } = await supabaseAdmin.auth.admin.getUserById(
      ctx.userId,
    );
    if (userError || !authUser.user?.email) throw new Error("تعذّر التحقق من حسابك");
    const email = authUser.user.email.toLowerCase().trim();

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("tenant_invites")
      .select("id, lease_id, created_at, used_at")
      .eq("email", email)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (inviteError || !invite) throw new Error("ما فيه دعوة معلّقة لهذا البريد");

    const hoursOld = (Date.now() - new Date(invite.created_at).getTime()) / 3_600_000;
    if (hoursOld > 72) throw new Error("انتهت صلاحية الدعوة — اطلب من المكتب دعوة جديدة");

    const { data: lease, error: leaseError } = await supabaseAdmin
      .from("leases")
      .select("tenant_id")
      .eq("id", invite.lease_id)
      .maybeSingle();
    if (leaseError || !lease?.tenant_id) throw new Error("تعذّر إيجاد بيانات المستأجر لهذا العقد");

    const { error: linkError } = await supabaseAdmin
      .from("tenants")
      .update({ user_id: ctx.userId })
      .eq("id", lease.tenant_id)
      .is("user_id", null);
    if (linkError) throw new Error("تعذّر ربط حسابك ببيانات المستأجر");

    await supabaseAdmin
      .from("tenant_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invite.id);
    return { ok: true };
  });

/**
 * دخول المستأجر (وكذلك المالك — نفس الآلية بالضبط) بقفل مؤقت بعد محاولات فاشلة متكررة. عام
 * (بدون تسجيل دخول مسبق، وإلا ما كان فيه فائدة من الدخول أصلًا) — التحقق من كلمة المرور يمر عبر
 * Supabase Auth نفسه، وهذه الدالة فقط تحيط تلك المحاولة بعدّاد قفل لا يوجد بديل له اليوم (المحدِّد
 * العام check_rate_limit يتطلب auth.uid() فيفشل قبل تسجيل الدخول أصلًا).
 */
export const portalSignIn = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; password: string }) =>
    z.object({ email: z.string().email(), password: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const email = data.email.toLowerCase().trim();
    const genericError = "الإيميل أو كلمة المرور غير صحيحة";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: attempt } = await supabaseAdmin
      .from("login_attempts")
      .select("failed_count, locked_until")
      .eq("email", email)
      .maybeSingle();
    if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
      throw new Error("الحساب مقفل مؤقتًا بسبب محاولات فاشلة متكررة — حاول بعد قليل");
    }

    const { data: signIn, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password: data.password,
    });

    if (signInError || !signIn.session) {
      const nextCount = (attempt?.failed_count ?? 0) + 1;
      const lockedUntil =
        nextCount >= MAX_FAILED_LOGINS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
          : null;
      await supabaseAdmin.from("login_attempts").upsert({
        email,
        failed_count: lockedUntil ? 0 : nextCount,
        locked_until: lockedUntil,
        last_attempt_at: new Date().toISOString(),
      });
      throw new Error(genericError);
    }

    // A real sign-in clears any accumulated failure count for this email.
    await supabaseAdmin.from("login_attempts").upsert({
      email,
      failed_count: 0,
      locked_until: null,
      last_attempt_at: new Date().toISOString(),
    });

    return {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    };
  });
