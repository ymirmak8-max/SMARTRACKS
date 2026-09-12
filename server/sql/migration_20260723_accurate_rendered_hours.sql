-- Normalize completed attendance records to scheduled, break-adjusted credited hours.
WITH calculated AS (
  SELECT tr.id,
         EXTRACT(EPOCH FROM (tr.clock_out - tr.clock_in)) / 3600.0 AS elapsed_hours,
         CASE
           WHEN EXTRACT(EPOCH FROM (d.work_end_time - d.work_start_time)) / 3600.0 > 0
             THEN EXTRACT(EPOCH FROM (d.work_end_time - d.work_start_time)) / 3600.0
           ELSE EXTRACT(EPOCH FROM (d.work_end_time - d.work_start_time)) / 3600.0 + 24
         END AS scheduled_gross_hours
  FROM time_records tr
  JOIN deployments d ON d.id = tr.deployment_id
  WHERE tr.clock_in IS NOT NULL AND tr.clock_out IS NOT NULL
), normalized AS (
  SELECT id, elapsed_hours, scheduled_gross_hours,
         GREATEST(0, LEAST(
           elapsed_hours - CASE WHEN elapsed_hours >= 6 THEN 1 ELSE 0 END,
           scheduled_gross_hours - CASE WHEN scheduled_gross_hours >= 6 THEN 1 ELSE 0 END
         )) AS credited_hours
  FROM calculated
)
UPDATE time_records tr
SET total_hours = ROUND(normalized.credited_hours::numeric, 2)
FROM normalized
WHERE tr.id = normalized.id;
