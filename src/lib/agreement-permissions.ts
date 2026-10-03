// خريطة صلاحيات اتفاقية الإدارة → تسمية عربية، مشتركة بين شاشتي المالك (owner.agreements.tsx)
// والمكتب (agreements.tsx) بدل تكرارها — القيم مطابقة لـ enum التحقق في
// 20260924160000_management_agreements_foundation.sql (agreement_permissions.permission).
//
// 'collection' و'tenant_comms' و'sale' مقبولة بالـ enum والـ RPCs لكن بلا أي إنفاذ RLS/Trigger
// فعلي بعد (20260924170000_wire_agreement_permissions_into_rls.sql لا تتحقق منها إطلاقًا) —
// UNENFORCED_PERMISSIONS تُستخدم لعرض "قريبًا" بدل الإيحاء بأثر فعلي غير موجود.
export const PERMISSION_LABEL: Record<string, string> = {
  leasing: "التأجير وإدارة العقود",
  pricing: "تسعير الوحدات",
  ejar: "تسجيل العقد في إيجار",
  collection: "التحصيل",
  maintenance: "الصيانة",
  tenant_comms: "التواصل مع المستأجر",
  renewal_eviction: "التجديد والإخلاء",
  sale: "البيع",
};
export const PERMISSION_OPTIONS = Object.keys(PERMISSION_LABEL);
export const UNENFORCED_PERMISSIONS = new Set(["collection", "tenant_comms", "sale"]);
