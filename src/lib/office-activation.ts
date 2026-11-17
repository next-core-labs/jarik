/**
 * لوحة تفعيل المكاتب (/hq → المكاتب والسوق): ما تعنيه كل عقبة ومن يحلّها.
 * القيم هي ما تُرجعه private.office_activation_rows في عمود blocker (migration 20261118180000)،
 * و`null` تعني أن المكتب ينشر عروضًا فعلًا.
 */
export type Blocker =
  | "not_verified"
  | "not_listed"
  | "not_published"
  | "no_price"
  | "no_units"
  | "all_occupied"
  | "other";

/** كل قيم blocker التي تستطيع القاعدة إرجاعها — الاختبار يثبت أن لكل واحدة شرحًا. */
export const BLOCKERS_FROM_DB: readonly Blocker[] = [
  "not_verified",
  "not_listed",
  "not_published",
  "no_price",
  "no_units",
  "all_occupied",
  "other",
];

export type BlockerInfo = {
  label: string;
  todo: string;
  /** action: يحلّها فريق المنصة من هذه الشاشة. nudge: تحتاج تواصلًا مع المكتب.
   *  cold: المكتب لم يبدأ بعد. ok: وضع صحّي لا يحتاج تدخلًا. */
  tone: "action" | "nudge" | "cold" | "ok";
};

export const BLOCKERS: Record<Blocker, BlockerInfo> = {
  not_verified: {
    label: "بانتظار توثيق المنصة",
    todo: "عروضه جاهزة — وثّقه من هنا وتظهر في السوق فورًا.",
    tone: "action",
  },
  not_listed: {
    label: "مخفي من دليل المكاتب",
    todo: "على المكتب تشغيل «إظهار المكتب في دليل المكاتب» من الإعدادات.",
    tone: "nudge",
  },
  not_published: {
    label: "لم يضغط «نشر في الموقع»",
    todo: "كل شيء جاهز — يكفي أن ينشر وحدة شاغرة واحدة.",
    tone: "nudge",
  },
  no_price: {
    label: "الوحدات الشاغرة بلا سعر",
    todo: "العروض بلا سعر لا تُنشر — يحتاج إضافة الإيجار السنوي أو سعر البيع.",
    tone: "nudge",
  },
  no_units: {
    label: "لا عقارات مسجّلة",
    todo: "سجّل ولم يُدخل عقاراته بعد — يحتاج متابعة تفعيل.",
    tone: "cold",
  },
  all_occupied: {
    label: "كل الوحدات مؤجّرة",
    todo: "وضع صحّي، لا شيء يُنشر الآن — تابعه عند أول وحدة شاغرة.",
    tone: "ok",
  },
  other: {
    label: "سبب غير محدّد",
    todo: "راجع بيانات المكتب ووحداته يدويًا.",
    tone: "cold",
  },
};

/** شرح العقبة، مع رجوع آمن إلى «سبب غير محدّد» لأي قيمة لم تُعرَّف بعد. */
export function blockerInfo(blocker: string | null): BlockerInfo | null {
  if (blocker === null) return null;
  return BLOCKERS[blocker as Blocker] ?? BLOCKERS.other;
}

export type ActivationRow = {
  id: string;
  company_name: string | null;
  created_at: string;
  manager_email: string | null;
  office_phone: string | null;
  whatsapp_number: string | null;
  city: string | null;
  district: string | null;
  verified: boolean;
  listed_publicly: boolean;
  units: number;
  vacant: number;
  vacant_priced: number;
  listed: number;
  live: number;
  live_with_photos: number;
  blocker: string | null;
  /** تذكيرات التفعيل التلقائية المُرسَلة لهذا المكتب (notify_cold_offices) — 3 كحد أقصى. */
  reminders_sent: number;
  last_reminder_at: string | null;
};

/** أقصى ما يُرسله notify_cold_offices لمكتب واحد (المراحل: 3 ثم 7 ثم 14 يومًا). */
export const MAX_AUTO_REMINDERS = 3;

/**
 * حالة التذكير التلقائي كما تُقرأ في اللوحة. تُحتسب التذكيرات على مستوى المكتب، وقد يكون له عدة
 * مديرين فالعدد المخزَّن هو عدد الإشعارات لا عدد الدفعات — لذا يُقسَّم على عدد المديرين تقديريًا
 * عند العرض. null حين لا ينطبق التذكير على هذه العقبة أصلًا.
 */
export function reminderNote(r: ActivationRow): string | null {
  // التذكير التلقائي يخص المكتب الذي لم يُدخل وحداته فقط — بقية العقبات تحتاج تواصلًا بشريًا.
  if (r.blocker !== "no_units") return null;
  if (r.reminders_sent === 0) {
    const age = Math.floor((Date.now() - Date.parse(r.created_at)) / 86_400_000);
    return age < 3
      ? "التذكير التلقائي الأول يُرسل بعد 3 أيام من التسجيل."
      : "التذكير التلقائي الأول يُرسل في تشغيل الغد.";
  }
  const left = Math.max(0, MAX_AUTO_REMINDERS - r.reminders_sent);
  const sent = `أُرسل ${r.reminders_sent === 1 ? "تذكير تلقائي واحد" : `${r.reminders_sent} تذكيرات تلقائية`}`;
  return left === 0
    ? `${sent} — انتهت التذكيرات التلقائية، يحتاج تواصلًا بشريًا.`
    : `${sent}، ويتبقّى ${left}.`;
}

/** مسار الوحدة حتى تظهر للزائر — أول رقم ينزل إلى صفر هو موضع التوقف. */
export function funnelSteps(r: ActivationRow): [string, number][] {
  return [
    ["وحدات", r.units],
    ["شاغرة", r.vacant],
    ["بسعر", r.vacant_priced],
    ["منشورة", r.listed],
    ["تظهر للزائر", r.live],
  ];
}
