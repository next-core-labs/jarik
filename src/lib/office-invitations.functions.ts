import * as React from "react";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getMyOrgId, type ServerCtx } from "@/lib/server-context";

const APP_URL = process.env["APP_URL"] ?? "https://jarak-ksa.com";

const ROLE_LABEL: Record<string, string> = {
  owner: "مالك",
  tenant: "مستأجر",
  staff: "موظف في فريق المكتب",
  technician: "فني صيانة لدى المكتب",
};

/**
 * Emails the person an office just invited (office_add_member / office_link_client only write the
 * invitation row, which shows up in the app once they sign in — they were never told by email).
 *
 * - No account yet: a Supabase invite (our Arabic template via the Send Email hook) that opens
 *   /tenant/activate to set a password; the invitation then waits in the in-app banner.
 * - Already has an account: a notice through Resend asking them to sign in and accept.
 */
export const emailOfficeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { email: string }) =>
    z.object({ email: z.string().trim().email().max(254) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ sent: "invite" | "notice" }> => {
    const ctx = context as unknown as ServerCtx;
    const { data: isManager, error: managerError } = await ctx.supabase.rpc("is_office_manager");
    if (managerError || !isManager) throw new Error("هذه الصلاحية لمدير المكتب فقط");
    const orgId = await getMyOrgId(ctx);
    await enforceRateLimit(ctx, "office_invitation_email", 30, 3600);

    const email = data.email.toLowerCase().trim();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only an invitation this office actually has pending for this address is ever emailed.
    const { data: invitation, error: invitationError } = await supabaseAdmin
      .from("invitations")
      .select("id, kind, role")
      .eq("org_id", orgId)
      .eq("email", email)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (invitationError || !invitation) throw new Error("لا توجد دعوة معلّقة لهذا البريد");

    const { data: office } = await supabaseAdmin
      .from("org_settings")
      .select("company_name")
      .eq("id", orgId)
      .maybeSingle();
    const officeName = office?.company_name?.trim() || null;
    const roleLabel = ROLE_LABEL[invitation.role] ?? null;

    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        // handle_new_user only accepts owner/tenant here; a team member picks their side later.
        ...(invitation.kind === "client" ? { account_type: invitation.role } : {}),
        invited_by_office: officeName,
        invited_as: roleLabel,
      },
      redirectTo: `${APP_URL}/tenant/activate`,
    });
    if (!inviteError) return { sent: "invite" };
    if (!/already registered|already exists|already been registered/i.test(inviteError.message)) {
      console.error("[office-invitation] invite email failed:", inviteError.message);
      throw new Error("حُفظت الدعوة لكن تعذّر إرسال البريد — تظهر لصاحب الحساب عند دخوله");
    }

    // An existing account: tell them by email that an invitation is waiting in the app.
    const apiKey = process.env["RESEND_API_KEY"];
    if (!apiKey) {
      console.error("[office-invitation] RESEND_API_KEY is not set");
      throw new Error("حُفظت الدعوة لكن تعذّر إرسال البريد — تظهر لصاحب الحساب عند دخوله");
    }
    const { InviteEmail } = await import("@/lib/email-templates/invite");
    const { SITE_NAME, SITE_URL, sendViaResend } = await import("@/lib/auth-email.server");
    try {
      await sendViaResend(
        {
          to: email,
          subject: officeName ? `دعوة من مكتب «${officeName}» على جارك` : "لديك دعوة على جارك",
          element: React.createElement(InviteEmail, {
            siteName: SITE_NAME,
            siteUrl: SITE_URL,
            confirmationUrl: `${APP_URL}/auth`,
            officeName,
            roleLabel,
            existingAccount: true,
          }),
        },
        apiKey,
        process.env["EMAIL_FROM"] || undefined,
      );
    } catch (e) {
      console.error("[office-invitation] notice email failed:", e);
      throw new Error("حُفظت الدعوة لكن تعذّر إرسال البريد — تظهر لصاحب الحساب عند دخوله");
    }
    return { sent: "notice" };
  });
