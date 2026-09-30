ALTER TABLE time_records ADD COLUMN IF NOT EXISTS clock_in_device_at TIMESTAMPTZ;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS clock_out_device_at TIMESTAMPTZ;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS clock_in_received_at TIMESTAMPTZ;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS clock_out_received_at TIMESTAMPTZ;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS clock_in_submission_id UUID;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS clock_out_submission_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS time_records_clock_in_submission_unique
  ON time_records(clock_in_submission_id) WHERE clock_in_submission_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS time_records_clock_out_submission_unique
  ON time_records(clock_out_submission_id) WHERE clock_out_submission_id IS NOT NULL;
