// خريطة صلاحيات اتفاقية الإدارة → تسمية عربية، مشتركة بين شاشتي المالك (owner.agreements.tsx)
// والمكتب (agreements.tsx) بدل تكرارها — القيم مطابقة لـ enum التحقق في
// 20260924160000_management_agreements_foundation.sql (agreement_permissions.permission).
//
// 'sale' مقبولة بالـ enum والـ RPCs لكن بلا إنفاذ فعلي بعد — UNENFORCED_PERMISSIONS تُستخدم لعرض
// "قريبًا" بدل الإيحاء بأثر غير موجود. 'collection' و'tenant_comms' تُنفَّذ منذ
// 20261107110000_owner_logic_office_scope.sql (الدفعات والفواتير والعدادات، ومحادثة الوحدة).
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
export const UNENFORCED_PERMISSIONS = new Set(["sale"]);
