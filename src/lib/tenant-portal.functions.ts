import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getMyOrgId, requireStaff, type ServerCtx } from "@/lib/server-context";

// No APP_URL env var exists in this project yet (checked: only client-side window.location.origin
// is used anywhere for redirect links, which a server function has no access to). Set APP_URL in
// the environment for this to be correct across environments; this falls back to the known
// production domain otherwise.
const APP_URL = process.env["APP_URL"] ?? "https://jarak-ksa.com";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export type TenantInviteResult = {
  /** The invite email went out (only when Resend is configured). */
  emailed: boolean;
  /** The email already has a Jarak account: no link — the lease links when they sign in. */
  existingAccount: boolean;
  /** The one-time activation link for a NEW account, for the office to send (WhatsApp / copy). */
  link: string | null;
};

/**
 * الموظف يدعو مستأجرًا على عقد بإيميله. تُسجَّل الدعوة (tenant_invites) ثم:
 * - حساب جديد: رابط تفعيل لمرة واحدة (generateLink، بلا بريد من Supabase) يُعاد للمكتب ليرسله
 *   بالواتساب أو ينسخه، ويُرسل بالبريد أيضًا بقالبنا العربي متى كان Resend مُعدًّا. كان الإرسال
 *   يعتمد على بريد Supabase الافتراضي الذي لا يصل إلا لعناوين فريق المشروع، فلم تصل الدعوات.
 * - بريد له حساب أصلًا: لا رابط (رابط دخول لحساب قائم لا يُسلَّم للمكتب أبدًا)؛ يُربط العقد
 *   بحسابه تلقائيًا عند دخوله (completeTenantActivation من لوحته)، ويُنبَّه بالبريد إن أمكن.
 */
export const inviteTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { leaseId: string; email: string }) =>
    z.object({ leaseId: z.string().uuid(), email: z.string().email() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<TenantInviteResult> => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    await enforceRateLimit(ctx, "tenant_invite", 30, 3600);

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

    const { data: office } = await supabaseAdmin
      .from("org_settings")
      .select("company_name")
      .eq("id", orgId)
      .maybeSingle();
    const officeName = office?.company_name?.trim() || null;

    // Creates the account if the email has none, and returns its one-time link without sending.
    const { data: generated, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { account_type: "tenant", invited_by_office: officeName, invited_as: "مستأجر" },
        redirectTo: `${APP_URL}/tenant/activate`,
      },
    });
    const existingAccount = Boolean(
      linkError &&
      /already registered|already exists|already been registered|email_exists/i.test(
        `${linkError.message} ${(linkError as { code?: string }).code ?? ""}`,
      ),
    );
    if (linkError && !existingAccount) {
      console.error("[inviteTenant] generateLink failed:", linkError.message);
      throw new Error("تعذّر إنشاء رابط التفعيل — حاول مرة أخرى");
    }
    const link = existingAccount ? null : (generated?.properties?.action_link ?? null);

    const emailed = await sendTenantInviteEmail({
      to: email,
      officeName,
      url: link ?? `${APP_URL}/tenant/login`,
      existingAccount,
    });
    return { emailed, existingAccount, link };
  });

/** The invite by email through Resend, when it is configured. Never throws: the link still works. */
async function sendTenantInviteEmail(input: {
  to: string;
  officeName: string | null;
  url: string;
  existingAccount: boolean;
}): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return false;
  try {
    const React = await import("react");
    const { InviteEmail } = await import("@/lib/email-templates/invite");
    const { SITE_NAME, SITE_URL, sendViaResend } = await import("@/lib/auth-email.server");
    await sendViaResend(
      {
        to: input.to,
        subject: input.officeName
          ? `دعوة من مكتب «${input.officeName}» على جارك`
          : "دعوة للانضمام إلى جارك",
        element: React.createElement(InviteEmail, {
          siteName: SITE_NAME,
          siteUrl: SITE_URL,
          confirmationUrl: input.url,
          officeName: input.officeName,
          roleLabel: "مستأجر",
          existingAccount: input.existingAccount,
        }),
      },
      apiKey,
      process.env["EMAIL_FROM"] || undefined,
    );
    return true;
  } catch (e) {
    console.error("[inviteTenant] email failed:", e);
    return false;
  }
}

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

    // Every pending invite to this (verified) email from the last 30 days — an office may invite the
    // same tenant on several leases. The account's own email is the proof: the invite named it.
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: invites, error: inviteError } = await supabaseAdmin
      .from("tenant_invites")
      .select("id, lease_id, org_id, created_at")
      .eq("email", email)
      .is("used_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (inviteError) throw new Error("تعذّر التحقق من دعوتك — حاول مرة أخرى");
    // Invited by an office as an owner or team member (invitations, accepted from the in-app
    // banner), or the tenant invites were already completed: nothing to link here.
    if (!invites?.length) return { ok: true, linked: false };

    let linked = 0;
    let lastProblem: string | null = null;
    for (const invite of invites) {
      const { data: lease } = await supabaseAdmin
        .from("leases")
        .select("tenant_id, tenants(user_id, org_id)")
        .eq("id", invite.lease_id)
        .maybeSingle();
      const tenant = lease?.tenants as { user_id: string | null; org_id: string | null } | null;
      if (!lease?.tenant_id || !tenant) {
        lastProblem = "تعذّر إيجاد بيانات المستأجر لهذا العقد";
        continue;
      }
      if (tenant.user_id && tenant.user_id !== ctx.userId) {
        lastProblem = "بيانات المستأجر في هذا العقد مربوطة بحساب آخر — تواصل مع المكتب";
        continue;
      }
      if (!tenant.user_id) {
        // Accepting the office's invite makes the account that office's client — the link guard
        // (private.may_link) refuses a person who isn't one, which is why activation never linked.
        const orgId = tenant.org_id ?? invite.org_id;
        if (orgId) {
          // Listed with the office's people like an accepted invitation (a member keeps membership).
          await supabaseAdmin
            .from("org_members")
            .upsert(
              {
                org_id: orgId,
                user_id: ctx.userId,
                kind: "client",
                role: "tenant",
                is_manager: false,
              },
              { onConflict: "org_id,user_id", ignoreDuplicates: true },
            );
          await supabaseAdmin
            .from("org_clients")
            .upsert(
              { org_id: orgId, user_id: ctx.userId, accepted_at: new Date().toISOString() },
              { onConflict: "org_id,user_id" },
            );
        }
        const { data: rows, error: linkError } = await supabaseAdmin
          .from("tenants")
          .update({ user_id: ctx.userId })
          .eq("id", lease.tenant_id)
          .is("user_id", null)
          .select("id");
        if (linkError || !rows?.length) {
          console.error("[completeTenantActivation] link failed:", linkError?.message);
          lastProblem = "تعذّر ربط حسابك ببيانات المستأجر — حاول مرة أخرى";
          continue;
        }
      }
      await supabaseAdmin
        .from("tenant_invites")
        .update({ used_at: new Date().toISOString() })
        .eq("id", invite.id);
      linked++;
    }
    if (linked === 0) throw new Error(lastProblem ?? "تعذّر ربط حسابك ببيانات المستأجر");

    // The tenant dashboard follows the tenant role: an owner or client account invited onto a
    // lease gets it too.
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: ctx.userId, role: "tenant" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    return { ok: true, linked: true };
  });

/**
 * دخول المستأجر (وكذلك المالك — نفس الآلية بالضبط) بقفل مؤقت بعد محاولات فاشلة متكررة. عام
 * (بدون تسجيل دخول مسبق، وإلا ما كان فيه فائدة من الدخول أصلًا) — التحقق من كلمة المرور يمر عبر
 * Supabase Auth نفسه، وهذه الدالة فقط تحيط تلك المحاولة بعدّاد قفل لا يوجد بديل له اليوم (المحدِّد
 * العام check_rate_limit يتطلب auth.uid() فيفشل قبل تسجيل الدخول أصلًا).
 */
export const portalSignIn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) =>
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
