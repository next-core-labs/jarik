import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMyOrgId, type ServerCtx } from "@/lib/server-context";

const inputSchema = z.object({
  phone: z.string().min(6).max(20),
  body: z.string().min(1).max(2000),
  channelId: z.string().uuid().nullable().optional(),
});

export const handleWhatsappMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: staff, error } = await context.supabase.rpc("is_staff", {
      _user_id: context.userId,
    });
    if (error || !staff) throw new Error("هذه الشاشة للفريق فقط");
    const orgId = await getMyOrgId(context as unknown as ServerCtx);

    // Row-level security only shows a channel to staff of the office that owns it.
    if (data.channelId) {
      const { data: channel } = await context.supabase
        .from("whatsapp_channels")
        .select("id")
        .eq("id", data.channelId)
        .maybeSingle();
      if (!channel) throw new Error("هذه القناة ليست من قنوات مكتبك");
    }

    const { processIncomingWhatsapp } = await import("@/lib/whatsapp.server");
    return processIncomingWhatsapp({
      orgId,
      phone: data.phone,
      body: data.body,
      channelId: data.channelId ?? null,
    });
  });
