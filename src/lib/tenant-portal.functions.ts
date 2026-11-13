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
  /** The email already has a Jarak account: no link for the office — the person accepts the
   * invitation from their account (or from the email). */
  existingAccount: boolean;
  /** The one-time activation link for a NEW account, for the office to send (WhatsApp / copy). */
  link: string | null;
};

/**
 * الموظف يدعو مستأجرًا على عقد بإيميله. تُسجَّل الدعوة (tenant_invites) ثم:
 * - حساب جديد: رابط تفعيل لمرة واحدة (generateLink، بلا بريد من Supabase) يُعاد للمكتب ليرسله
 *   بالواتساب أو ينسخه، ويُرسل بالبريد أيضًا بقالبنا العربي متى كان Resend مُعدًّا. كان الإرسال
 *   يعتمد على بريد Supabase الافتراضي الذي لا يصل إلا لعناوين فريق المشروع، فلم تصل الدعوات.
 * - بريد له حساب أصلًا (أو دعاه مكتب آخر ولم يُفعَّل): لا رابط للمكتب — رابط دخول لحساب لا
 *   يملكه المكتب لا يُسلَّم له أبدًا. تظهر الدعوة لصاحب الحساب عند دخوله فيقبلها أو يرفضها.
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
    const { data: office } = await supabaseAdmin
      .from("org_settings")
      .select("company_name")
      .eq("id", orgId)
      .maybeSingle();
    const officeName = office?.company_name?.trim() || null;

    // Who invited this email first: only that office may ever be handed a sign-in link for it.
    const { data: earliest } = await supabaseAdmin
      .from("tenant_invites")
      .select("org_id")
      .eq("email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // Create the account first: Supabase refuses an email that already has one, so success proves
    // THIS call created it (a timestamp comparison can't tell a just-created account apart).
    const meta = { account_type: "tenant", invited_by_office: officeName, invited_as: "مستأجر" };
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: meta,
    });
    const isExisting = (e: { message: string; code?: string | undefined } | null) =>
      Boolean(
        e &&
        /already registered|already exists|already been registered|email_exists/i.test(
          `${e.message} ${e.code ?? ""}`,
        ),
      );
    if (created.error && !isExisting(created.error)) {
      console.error("[inviteTenant] createUser failed:", created.error.message);
      throw new Error("تعذّر إنشاء حساب المستأجر — حاول مرة أخرى");
    }
    const createdNow = !created.error;

    // The one-time link, without sending. For an account that exists but never activated Supabase
    // returns a fresh link to IT; for an activated account it refuses (email_exists).
    const { data: generated, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: meta, redirectTo: `${APP_URL}/tenant/activate` },
    });
    const confirmedAccount = isExisting(linkError);
    if (linkError && !confirmedAccount) {
      console.error("[inviteTenant] generateLink failed:", linkError.message);
      throw new Error("تعذّر إنشاء رابط التفعيل — حاول مرة أخرى");
    }
    const actionLink = confirmedAccount ? null : (generated?.properties?.action_link ?? null);

    // The link signs whoever opens it into the account, so the office sees it only for its OWN
    // invitee: an account this call created, or one this office invited first and that never
    // activated. Otherwise another office could take over someone else's pending account.
    const ownInvitee =
      !confirmedAccount &&
      (createdNow || (earliest?.org_id === orgId && !generated?.user?.email_confirmed_at));

    // Recorded only once the account side worked, so no invite is left without an account.
    const { error: inviteError } = await supabaseAdmin.from("tenant_invites").insert({
      lease_id: data.leaseId,
      org_id: orgId,
      email,
      created_by: ctx.userId,
    });
    if (inviteError) throw new Error("تعذّر إنشاء الدعوة");

    // The email goes to the mailbox's owner, so it may carry the link in every case.
    const existingAccount = !ownInvitee;
    const emailed = await sendTenantInviteEmail({
      to: email,
      officeName,
      url: actionLink ?? `${APP_URL}/tenant/login`,
      existingAccount: confirmedAccount,
    });
    return { emailed, existingAccount, link: ownInvitee ? actionLink : null };
  });

/** True when the account is on some office's team (kind = member). */
async function isOfficeMember(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("org_members")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "member");
  return (count ?? 0) > 0;
}

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

const INVITE_DAYS = 30;

/** The signed-in account's CONFIRMED email — an unconfirmed address proves nothing. */
async function confirmedEmail(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("تعذّر التحقق من حسابك");
  if (!data.user.email_confirmed_at) return null;
  return data.user.email.toLowerCase().trim();
}

export type PendingTenantInvite = { id: string; officeName: string; unitLabel: string };

/** Lease invitations waiting for the signed-in person to accept or decline (read only). */
export const pendingTenantInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingTenantInvite[]> => {
    const ctx = context as unknown as ServerCtx;
    const email = await confirmedEmail(ctx.userId);
    if (!email) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - INVITE_DAYS * 86_400_000).toISOString();
    const { data } = await supabaseAdmin
      .from("tenant_invites")
      .select(
        "id, org_settings(company_name), leases(tenants(user_id), units(unit_number, unit_name, properties(name)))",
      )
      .eq("email", email)
      .is("used_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    return (data ?? [])
      .filter((i) => {
        // Already this person's lease: nothing to accept.
        const tenant = (i.leases as { tenants: { user_id: string | null } | null } | null)?.tenants;
        return !tenant?.user_id || tenant.user_id !== ctx.userId;
      })
      .map((i) => {
        const unit = (
          i.leases as {
            units: {
              unit_number: string;
              unit_name: string | null;
              properties: { name: string } | null;
            } | null;
          } | null
        )?.units;
        return {
          id: i.id,
          officeName:
            (i.org_settings as { company_name: string | null } | null)?.company_name?.trim() ||
            "مكتب عقاري",
          unitLabel: unit
            ? `${unit.properties?.name ?? ""} · ${unit.unit_name || `وحدة ${unit.unit_number}`}`
            : "عقد إيجار",
        };
      });
  });

/** Declines lease invitations addressed to the signed-in person's email. */
export const declineTenantInvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { inviteIds: string[] }) =>
    z.object({ inviteIds: z.array(z.string().uuid()).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    const email = await confirmedEmail(ctx.userId);
    if (!email) throw new Error("أكّد بريدك الإلكتروني أولًا");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("tenant_invites")
      .update({ used_at: new Date().toISOString() })
      .in("id", data.inviteIds)
      .eq("email", email)
      .is("used_at", null);
    return { ok: true };
  });

/**
 * The person ACCEPTS the office's lease invitation(s): from /tenant/activate (opening the invite link
 * and setting a password is the acceptance) or «قبول» on the in-app invitation. Never called
 * silently. Needs a confirmed email — the invite named that email, so only its owner may accept.
 */
export const completeTenantActivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ inviteIds: z.array(z.string().uuid()).min(1).max(20).optional() })
      .optional()
      .parse(input),
  )
  .handler(async ({ data: input, context }) => {
    const ctx = context as unknown as ServerCtx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = await confirmedEmail(ctx.userId);
    if (!email) throw new Error("أكّد بريدك الإلكتروني أولًا ثم اقبل الدعوة");

    // Pending invites to this email from the last 30 days (only the chosen ones when given) — an
    // office may invite the same tenant on several leases.
    const since = new Date(Date.now() - INVITE_DAYS * 86_400_000).toISOString();
    let query = supabaseAdmin
      .from("tenant_invites")
      .select("id, lease_id, org_id, created_at")
      .eq("email", email)
      .is("used_at", null)
      .gte("created_at", since);
    if (input?.inviteIds) query = query.in("id", input.inviteIds);
    const { data: invites, error: inviteError } = await query.order("created_at", {
      ascending: false,
    });
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
        if (orgId && !(await isOfficeMember(ctx.userId))) {
          // Listed with the office's people like an accepted invitation. A team member of any office
          // is not made another office's client (private.my_org() would pick between the two).
          await supabaseAdmin.from("org_members").upsert(
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
