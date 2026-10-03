-- إصلاح عطل حي: سوق العروض والصفحات العامة (المكاتب/الملاك) لا تظهر للزوار غير المسجّلين.
--
-- السبب الجذري: عرّفت 20260924000658 سياسات org_settings من جديد بقفلها على الموظفين فقط
-- (comment فيها: "الجمهور يقرأ عبر العروض العامة" — أي أن القراءة العامة يفترض أن تمر عبر
-- الـviews دون فرض RLS الجدول الأساسي)، لكن 20260924000729 عرّفت نفس الـviews العامة
-- (vacant_units_public, vacant_unit_photos_public, owner_pages_public, office_pages_public)
-- بخاصية WITH (security_invoker = true) — وهذا بالضبط عكس المطلوب: يجعل الـview يخضع من جديد
-- لصلاحيات وRLS من يستدعيها (anon)، بدل تجاوزها. النتيجة: لا صف واحد يظهر للزائر غير المسجّل
-- مهما كانت البيانات، لأن كل سياسات SELECT على org_settings مقيّدة بـ "TO authenticated" فقط.
--
-- تأكيد مباشر من قاعدة البيانات الحيّة (anon key): استعلام office_directory (view أقدم، بلا
-- security_invoker) يرجع صف مكتب حقيقي (listed_publicly + verified)، بينما office_pages_public
-- بنفس شرط التصفية بالضبط يرجع صفًا فارغًا لنفس البيانات.
--
-- الإصلاح: نعيد تعريف نفس الأربع views بنفس أعمدتها الآمنة (بلا أرقام أو حقول حسّاسة إضافية)،
-- بدون WITH (security_invoker = true) — أي كما كانت قبل 20260924000729، تمامًا يوافق النية
-- الموثّقة في تعليق 20260924000658 نفسها. لا تغيير على RLS أو الصلاحيات على الجداول الأساسية:
-- القراءة المباشرة لـunits/org_settings/owner_pages تبقى مقفلة على الموظفين كما هي.

DROP VIEW IF EXISTS public.vacant_unit_photos_public;
DROP VIEW IF EXISTS public.owner_pages_public;
DROP VIEW IF EXISTS public.office_pages_public;
DROP VIEW IF EXISTS public.vacant_units_public;

CREATE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, u.floor_no,
  u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.sale_price, u.listing_purpose,
  u.furnished, u.listing_description, u.amenities, u.created_at,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp
FROM public.units u
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = COALESCE(
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id AND m.kind = 'member' LIMIT 1),
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id LIMIT 1),
  (SELECT s.id FROM public.org_settings s WHERE s.listed_publicly AND s.verified ORDER BY s.created_at LIMIT 1)
)
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published
WHERE u.status = 'vacant' AND u.market_listed;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

CREATE VIEW public.vacant_unit_photos_public AS
SELECT ph.unit_id, ph.path, ph.position
FROM public.unit_photos ph
JOIN public.vacant_units_public v ON v.id = ph.unit_id;
GRANT SELECT ON public.vacant_unit_photos_public TO anon, authenticated;

CREATE VIEW public.owner_pages_public AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.phone, op.whatsapp,
  op.avatar_path,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op WHERE op.published;
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;

CREATE VIEW public.office_pages_public AS
SELECT o.id, o.company_name, o.bio, o.logo_url, o.banner_path, o.city, o.district, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count
FROM public.org_settings o WHERE o.listed_publicly AND o.verified;
GRANT SELECT ON public.office_pages_public TO anon, authenticated;
