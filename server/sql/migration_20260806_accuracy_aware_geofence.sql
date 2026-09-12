UPDATE system_settings
SET value = jsonb_set(value, '{maximumGpsAccuracyMeters}', '50'::jsonb),
    updated_at = NOW()
WHERE key = 'attendance_policy'
  AND COALESCE((value->>'maximumGpsAccuracyMeters')::numeric, 100) = 100;
