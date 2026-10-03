// خريطة صلاحيات لوحة المدير العام (/hq) → تسمية عربية، مشتركة بين بانر الدعوات وتبويب "المدراء".
// القيم مطابقة لقيد التحقق في 20260926100000_hq_admin_management.sql (وتوسعته
// 20260927205832_hq_offices_and_featured_listings.sql) على hq_admins/hq_invitations.permissions.
//
// السبعة صارت فعّالة كلها: subscribers (المرحلة 1)، accounting (المرحلة 3)، commissions
// (المرحلة 4)، reviews (المرحلة 5)، offices وsystem (دفعة توسيع /hq اللاحقة)، وannouncements (بث
// إعلان لكل المستأجرين والملاك، 20260929100000_hq_platform_announcements.sql). UNENFORCED_HQ_PERMISSIONS
// فارغة الآن — أُبقيت كآلية جاهزة لو أُضيفت صلاحية قسم جديدة لاحقًا قبل تفعيلها فعليًا.
export const HQ_PERMISSION_LABEL: Record<string, string> = {
  subscribers: "دليل المشتركين وسجل النشاط والنظرة العامة",
  accounting: "المحاسبة",
  commissions: "عمولة الموقع",
  reviews: "التقييمات والشكاوى وعملاء VIP",
  offices: "المكاتب والسوق (توثيق، واتساب، تمييز العروض)",
  system: "النظام (إعدادات المنصة وصحة المهام وSEO)",
  announcements: "شات الإعلانات (بث لكل المستأجرين والملاك)",
};
export const HQ_PERMISSION_OPTIONS = Object.keys(HQ_PERMISSION_LABEL);
export const UNENFORCED_HQ_PERMISSIONS = new Set<string>([]);
