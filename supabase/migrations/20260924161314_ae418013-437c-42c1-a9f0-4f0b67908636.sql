DELETE FROM public.meter_readings a
USING public.meter_readings b
WHERE a.unit_id = b.unit_id
  AND a.meter_type = b.meter_type
  AND a.reading_date = b.reading_date
  AND (a.created_at < b.created_at OR (a.created_at = b.created_at AND a.id < b.id));

CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_unit_type_date_key
  ON public.meter_readings (unit_id, meter_type, reading_date);