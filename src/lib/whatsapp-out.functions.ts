import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { daysBetween, todayRiyadh } from "@/lib/dates";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getMyOrgId, requireStaff, type ServerCtx } from "@/lib/server-context";

/** حالة ربط واتساب لمكتب الموظف (مقفل من الإدارة؟ هل المزوّد مضبوط؟). */
export const getWhatsappProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    const orgId = await getMyOrgId(ctx);
    const { whatsappProviderStatus } = await import("@/lib/whatsapp-out.server");
    return whatsappProviderStatus(orgId);
  });

/** الموظف يرسل رسالة واتساب لأي رقم (تذكير، إشعار، متابعة). */
export const sendOfficeWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; body: string; intent?: string | undefined }) =>
    z
      .object({
        phone: z.string().min(6).max(20),
        body: z.string().min(1).max(1500),
        intent: z.string().max(60).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    const orgId = await getMyOrgId(ctx);
    // Unlike sendPortalMessage (client-facing, already limited), this sends to an arbitrary phone a
    // staff member types in — 20 per 10 minutes bounds a compromised/malicious session's spam volume
    // through the office's own WhatsApp number without hampering normal staff use.
    await enforceRateLimit(
      ctx,
      "office-whatsapp",
      20,
      600,
      "أرسلت رسائل واتساب كثيرة — انتظر قليلًا ثم حاول مجددًا",
    );

    const { isWhatsappLocked, WHATSAPP_LOCKED_MSG, sendWhatsappOut } =
      await import("@/lib/whatsapp-out.server");
    if (await isWhatsappLocked(orgId)) throw new Error(WHATSAPP_LOCKED_MSG);

    return sendWhatsappOut({
      orgId,
      phone: data.phone,
      body: data.body,
      intent: data.intent ?? "رسالة من المكتب",
    });
  });

/** تذكير دفعات: إشعار داخل المنصة + رسالة واتساب للمستأجر (لدفعات مكتب الموظف فقط). */
export const remindPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paymentIds: string[] }) =>
    z.object({ paymentIds: z.array(z.string().uuid()).min(1).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    const orgId = await getMyOrgId(ctx);
    // A single call can already fan out to up to 100 payments (paymentIds max), so this bounds
    // call *frequency* rather than per-message volume — 5 calls per 10 minutes still caps a
    // compromised session's total burst instead of leaving it unthrottled.
    await enforceRateLimit(
      ctx,
      "remind-payments",
      5,
      600,
      "أرسلت تذكيرات كثيرة — انتظر قليلًا ثم حاول مجددًا",
    );

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsappOut } = await import("@/lib/whatsapp-out.server");

    // Read with the caller's own client: row-level security keeps this to the office's payments,
    // so ids belonging to another office are simply not returned.
    const { data: rows, error } = await ctx.supabase
      .from("payments")
      .select(
        "id, amount, due_date, status, lease_id, leases(tenant_id, tenants(full_name, phone, user_id), units(unit_number, properties(name)))",
      )
      .in("id", data.paymentIds);
    if (error) throw error;

    const today = todayRiyadh();
    let notified = 0;
    let whatsapped = 0;

    for (const p of rows ?? []) {
      if (p.status === "paid") continue;
      const tenant = p.leases?.tenants ?? null;
      const unitLabel =
        `${p.leases?.units?.properties?.name ?? ""} وحدة ${p.leases?.units?.unit_number ?? ""}`.trim();

      const { data: openRows } = await ctx.supabase
        .from("payments")
        .select("amount")
        .eq("lease_id", p.lease_id)
        .neq("status", "paid");
      const remaining = (openRows ?? []).reduce((s, x) => s + Number(x.amount), 0);

      // Calendar days in Saudi time. `due_date` parses as UTC midnight, so subtracting Date.now()
      // reported "late 1 day" on the due date itself after 03:00 Riyadh.
      const days = daysBetween(today, p.due_date);
      const when =
        days < 0
          ? `متأخرة ${Math.abs(days)} يوم`
          : days === 0
            ? "تستحق اليوم"
            : `تستحق بعد ${days} يوم`;
      const body = `تذكير بدفعة الإيجار: ${Number(p.amount).toLocaleString("ar-SA")} ر.س ${when} (${p.due_date}) — ${unitLabel}. الرصيد المتبقي: ${remaining.toLocaleString("ar-SA")} ر.س.`;

      let delivered = false;
      if (tenant?.user_id) {
        const { error: notifyError } = await supabaseAdmin.from("notifications").insert({
          user_id: tenant.user_id,
          org_id: orgId,
          title: "تذكير باستحقاق دفعة",
          body,
          kind: "payment_reminder",
          source: "system",
          related_table: "payments",
          related_id: p.id,
        });
        if (notifyError) {
          console.error("[remindPayments] notification insert failed:", notifyError.message);
        } else {
          notified += 1;
          delivered = true;
        }
      }
      if (tenant?.phone) {
        const res = await sendWhatsappOut({
          orgId,
          phone: tenant.phone,
          body,
          intent: "تذكير سداد",
        });
        if (res.sent) {
          whatsapped += 1;
          delivered = true;
        }
      }
      // Only mark the payment as reminded if a reminder actually reached someone.
      if (delivered) {
        await supabaseAdmin
          .from("payments")
          .update({ last_reminded_at: new Date().toISOString() })
          .eq("id", p.id);
      }
    }

    return { notified, whatsapped, total: (rows ?? []).length };
  });

/** رسالة من المالك أو المستأجر إلى مكتبه: إشعار لفريق المكتب + واتساب على رقم المكتب. */
export const sendPortalMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { body: string; officeId?: string }) =>
    z
      .object({ body: z.string().min(2).max(1200), officeId: z.string().uuid().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    // Every message notifies the office's staff (and WhatsApps the office once unlocked): 10 per 10 minutes.
    await enforceRateLimit(
      ctx,
      "portal-message",
      10,
      600,
      "أرسلت رسائل كثيرة — انتظر قليلًا ثم حاول مجددًا",
    );
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsappOut } = await import("@/lib/whatsapp-out.server");
    const { orgsOfUser, staffIdsOfOrg } = await import("@/lib/org.server");

    // The message goes to ONE office this account works with. Copying it to every office it deals
    // with would hand each of them the others' correspondence.
    const orgIds = await orgsOfUser(supabaseAdmin, ctx.userId);
    if (orgIds.length === 0) {
      throw new Error("حسابك غير مرتبط بمكتب بعد — تواصل مع مكتبك ليربط حسابك");
    }
    if (data.officeId && !orgIds.includes(data.officeId)) {
      throw new Error("هذا المكتب ليس من مكاتبك");
    }
    const officeId = data.officeId ?? orgIds[0]!;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone")
      .eq("id", ctx.userId)
      .maybeSingle();
    const senderName = profile?.full_name ?? "عميل";

    const staffIds = new Set<string>(await staffIdsOfOrg(supabaseAdmin, officeId));
    if (staffIds.size > 0) {
      await supabaseAdmin.from("notifications").insert(
        [...staffIds].map((id) => ({
          user_id: id,
          org_id: officeId,
          title: `رسالة من ${senderName}`,
          body: data.body,
          kind: "message",
          source: "portal",
        })),
      );
    }

    // WhatsApp to that office's number, if it has one.
    const { data: org } = await supabaseAdmin
      .from("org_settings")
      .select("office_phone, whatsapp_number")
      .eq("id", officeId)
      .maybeSingle();
    const officePhone = org?.whatsapp_number ?? org?.office_phone ?? null;
    let sent = false;
    if (officePhone) {
      const res = await sendWhatsappOut({
        orgId: officeId,
        phone: officePhone,
        body: `رسالة من ${senderName}${profile?.phone ? ` (${profile.phone})` : ""}:\n${data.body}`,
        intent: "رسالة عميل",
      });
      sent = res.sent;
    }
    return { ok: true, whatsapp: sent };
  });

/** المكتب يرد على مالك أو مستأجر من عملائه: إشعار داخلي + واتساب إن توفّر رقمه. */
export const replyToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; body: string }) =>
    z.object({ userId: z.string().uuid(), body: z.string().min(2).max(1200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    const orgId = await getMyOrgId(ctx);

    // Row-level security only shows a profile to staff whose office is connected to that account.
    const { data: visible } = await ctx.supabase
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!visible) throw new Error("هذا الحساب ليس من عملاء مكتبك");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsappOut } = await import("@/lib/whatsapp-out.server");

    await supabaseAdmin.from("notifications").insert({
      user_id: data.userId,
      org_id: orgId,
      title: "رسالة من المكتب",
      body: data.body,
      kind: "message",
      source: "system",
    });

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone")
      .eq("id", data.userId)
      .maybeSingle();
    let sent = false;
    if (profile?.phone) {
      const res = await sendWhatsappOut({
        orgId,
        phone: profile.phone,
        body: data.body,
        intent: "رد المكتب",
      });
      sent = res.sent;
    }
    return { ok: true, whatsapp: sent };
  });
