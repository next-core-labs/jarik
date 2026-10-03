/**
 * كلمات تدل على عطل يحتاج تدخّلًا فوريًا (تسرب مياه، خطر كهربائي أو حريق، انقطاع غاز) — أي مطابقة
 * بعنوان أو وصف طلب الصيانة ترفع أولويته لـ"عاجلة" تلقائيًا بصرف النظر عمّا اختاره مقدّم الطلب.
 */
const URGENT_KEYWORDS = [
  "تسرب",
  "تسريب",
  "غرق",
  "حريق",
  "دخان",
  "احتراق",
  "ماس كهربائي",
  "صعق",
  "انقطاع كهرباء",
  "انقطاع التيار",
  "شم رائحة غاز",
  "رائحة غاز",
  "تسرب غاز",
  "انفجار",
];

/** true لو النص (عنوان أو وصف الطلب) يحتوي أي كلمة عاجلة معروفة. */
export function isUrgentMaintenanceText(text: string): boolean {
  const normalized = text.toLowerCase();
  return URGENT_KEYWORDS.some((k) => normalized.includes(k));
}

/**
 * الأولوية الفعلية لطلب صيانة جديد: "عاجلة" تلقائيًا لو العنوان أو الوصف يحتوي كلمة تدل على خطر
 * فوري، وإلا الأولوية المطلوبة (أو المتوسطة افتراضيًا).
 */
export function classifyMaintenancePriority(
  title: string,
  description: string | null | undefined,
  requested: string = "medium",
): string {
  if (isUrgentMaintenanceText(title) || (description && isUrgentMaintenanceText(description))) {
    return "urgent";
  }
  return requested;
}
