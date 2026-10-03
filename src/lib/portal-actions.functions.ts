import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ServerCtx } from "@/lib/server-context";

/** المستأجر يبلّغ عن تحويل دفعة مع مرجع الحوالة — يصل كإشعار لموظفي المكتب. */
export const submitTransferNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { paymentId: string; reference: string }) =>
    z.object({ paymentId: z.string().uuid(), reference: z.string().min(3).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    // "Can read the row" is not proof of ownership (owners can read payments too), so require
    // the payment to belong to a lease whose tenant is the caller.
    const { data: payment, error } = await ctx.supabase
      .from("payments")
      .select("id, amount, due_date, status, leases!inner(tenants!inner(user_id))")
      .eq("id", data.paymentId)
      .eq("leases.tenants.user_id", ctx.userId)
      .maybeSingle();
    if (error || !payment) throw new Error("لم نجد هذه الدفعة في حسابك");
    if (payment.status === "paid") throw new Error("هذه الدفعة مسدّدة مسبقًا");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");
    const { error: upErr } = await supabaseAdmin
      .from("payments")
      .update({
        transfer_reference: data.reference,
        transfer_submitted_at: new Date().toISOString(),
      })
      .eq("id", data.paymentId)
      .neq("status", "paid");
    if (upErr) throw upErr;

    const { orgOf } = await import("@/lib/org.server");
    const orgId = await orgOf(supabaseAdmin, "payments", data.paymentId);
    await notifyStaff(supabaseAdmin, orgId, {
      title: "المستأجر أبلغ عن سداد دفعة",
      body: `مبلغ ${Number(payment.amount)} ر.س (استحقاق ${payment.due_date}) — مرجع التحويل: ${data.reference}`,
      kind: "payment",
      related_table: "payments",
      related_id: data.paymentId,
    });
    return { ok: true };
  });

/** المستأجر يقيّم تجربة الصيانة بعد الإنجاز (مرة واحدة، على طلباته فقط). */
export const rateMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string; rating: number; note?: string | undefined }) =>
    z
      .object({
        requestId: z.string().uuid(),
        rating: z.number().int().min(1).max(5),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    // The assigned technician and the owner can also read the request, so filter on the tenant.
    const { data: req, error } = await ctx.supabase
      .from("maintenance_requests")
      .select("id, title, status, rated_at, tenants!inner(user_id)")
      .eq("id", data.requestId)
      .eq("tenants.user_id", ctx.userId)
      .maybeSingle();
    if (error || !req) throw new Error("لم نجد طلب الصيانة");
    if (req.status !== "done") throw new Error("التقييم متاح بعد إنجاز الطلب");
    if (req.rated_at) throw new Error("سبق أن قيّمت هذا الطلب");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("maintenance_requests")
      .update({
        rating: data.rating,
        rating_note: data.note ?? null,
        rated_at: new Date().toISOString(),
      })
      .eq("id", data.requestId)
      .is("rated_at", null)
      .select("id");
    if (upErr) throw upErr;
    if (!updated || updated.length === 0) throw new Error("سبق أن قيّمت هذا الطلب");

    const { orgOf } = await import("@/lib/org.server");
    const orgId = await orgOf(supabaseAdmin, "maintenance_requests", data.requestId);
    await notifyStaff(supabaseAdmin, orgId, {
      title: `تقييم صيانة: ${req.title}`,
      body: `${data.rating} من 5${data.note ? ` — ${data.note}` : ""}`,
      kind: "maintenance",
      related_table: "maintenance_requests",
      related_id: data.requestId,
    });
    return { ok: true };
  });

/** المالك يوافق أو يرفض طلب صيانة يتجاوز حد المبلغ (طلب معلّق فقط). */
export const decideMaintenanceApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string; approved: boolean; note?: string | undefined }) =>
    z
      .object({
        requestId: z.string().uuid(),
        approved: z.boolean(),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    const { data: req, error } = await ctx.supabase
      .from("maintenance_requests")
      .select("id, title, cost, unit_id, approval_status, units(owner_id, properties(owner_id))")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error || !req) throw new Error("لم نجد طلب الصيانة");

    // Same rule as private.unit_owner(): the unit's own owner wins, else the property's owner.
    const owner = req.units?.owner_id ?? req.units?.properties?.owner_id ?? null;
    if (!owner || ctx.userId !== owner) {
      throw new Error("هذه الموافقة لمالك الوحدة فقط");
    }
    if (req.approval_status !== "pending") {
      throw new Error("لا توجد موافقة معلّقة على هذا الطلب");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("maintenance_requests")
      .update({
        approval_status: data.approved ? "approved" : "rejected",
        approval_note: data.note ?? null,
      })
      .eq("id", data.requestId)
      .eq("approval_status", "pending")
      .select("id");
    if (upErr) throw upErr;
    if (!updated || updated.length === 0) throw new Error("لا توجد موافقة معلّقة على هذا الطلب");

    const { orgOf } = await import("@/lib/org.server");
    const orgId = await orgOf(supabaseAdmin, "maintenance_requests", data.requestId);
    await notifyStaff(supabaseAdmin, orgId, {
      title: `${data.approved ? "موافقة" : "رفض"} المالك على صيانة: ${req.title}`,
      body: `التكلفة ${Number(req.cost ?? 0)} ر.س${data.note ? ` — ${data.note}` : ""}`,
      kind: "maintenance",
      related_table: "maintenance_requests",
      related_id: data.requestId,
    });

    // إبلاغ المكتب على واتساب أيضًا إن توفّر رقم المكتب ومزوّد الرسائل
    const { data: org } = await supabaseAdmin
      .from("org_settings")
      .select("office_phone, whatsapp_number")
      .eq("id", orgId)
      .maybeSingle();
    const officePhone = org?.whatsapp_number ?? org?.office_phone ?? null;
    if (officePhone) {
      const { sendWhatsappOut } = await import("@/lib/whatsapp-out.server");
      await sendWhatsappOut({
        orgId,
        phone: officePhone,
        body: `${data.approved ? "وافق" : "رفض"} المالك على طلب الصيانة: ${req.title} — التكلفة ${Number(req.cost ?? 0)} ر.س${data.note ? ` (${data.note})` : ""}`,
        intent: "موافقة صيانة",
      });
    }
    return { ok: true };
  });
