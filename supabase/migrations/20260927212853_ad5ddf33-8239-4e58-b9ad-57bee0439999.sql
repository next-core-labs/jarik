-- المرحلة C من توسيع لوحة "المدير العام" (/hq): تعليق حساب مشترك. الإنفاذ يعتمد حصرًا على آلية
-- Supabase Auth المدمجة (ban_duration، تُستدعى من hqSetAccountSuspended بـsuper-admin.functions.ts
-- عبر supabaseAdmin.auth.admin.updateUserById) — عمدًا بلا حارس إضافي بـauth-middleware.ts (ملف
-- مولَّد تلقائيًا من Lovable، معلَّم "Do not edit it directly"). حدّ معروف مقصود: أي JWT صادر قبل
-- التعليق يبقى صالحًا حتى انتهاء صلاحيته الطبيعية (~ساعة)، فالتعليق يمنع دخولًا/تجديد جلسة جديدًا
-- فورًا لكنه ليس قطعًا فوريًا 100%. عمودا profiles هنا للعرض فقط بواجهة /hq (من صار معلَّقًا ومتى).
-- نفس قفل عمود vip بالضبط (20260926120000) — profiles_update الحالية تسمح لأي حساب بتعديل صفه
-- الخاص بلا قيد على عمود معيّن؛ لو تُركا ضمنها لقدر أي حساب معلَّق يرفع تعليقه عن نفسه مباشرة.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
REVOKE UPDATE (suspended, suspended_at) ON public.profiles FROM authenticated;