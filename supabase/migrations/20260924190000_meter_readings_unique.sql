-- =============================================================================================
-- من roadmap.md «متبقٍ»: مزامنة إيجار (معطّلة حتى الآن) كانت تكرّر قراءة العداد نفسها بكل مزامنة
-- (INSERT عادي بلا فحص تكرار — أُصلح في src/lib/ejar.functions.ts، تحويله لـ upsert). هذا القيد
-- هو ما يجعل upsert ذاك فعليًا يعمل (upsert يحتاج فهرسًا فريدًا يطابق عليه)، وكان مؤجَّلًا صراحة
-- "بعد إصلاح مزامنة إيجار حتى لا تفشل المزامنة عند التكرار" — الإصلاح صار الآن.
--
-- حذف تكراري احترازي أولًا: لو أي تشغيل سابق (قبل هذا الإصلاح) للمزامنة ترك صفوفًا مكرّرة فعلاً،
-- إضافة القيد مباشرة بدونه كانت سترفض الـ migration نفسها. يُبقي الأحدث (created_at) لكل
-- (unit_id, meter_type, reading_date) ويحذف الباقي — بلا أثر لو ما فيه تكرار أصلًا (EJAR كانت
-- معطّلة بلا مفاتيح، فالأرجح لا يوجد أي صف من هذا المصدر حاليًا).
-- =============================================================================================

DELETE FROM public.meter_readings a
USING public.meter_readings b
WHERE a.unit_id = b.unit_id
  AND a.meter_type = b.meter_type
  AND a.reading_date = b.reading_date
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_unit_type_date_key
  ON public.meter_readings (unit_id, meter_type, reading_date);
