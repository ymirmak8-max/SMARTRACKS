ALTER TABLE attendance_exceptions
  ADD COLUMN IF NOT EXISTS proposed_clock_in TIME,
  ADD COLUMN IF NOT EXISTS proposed_clock_out TIME,
  ADD COLUMN IF NOT EXISTS original_record JSONB,
  ADD COLUMN IF NOT EXISTS applied_record_id UUID REFERENCES time_records(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS attendance_exceptions_pending_idx
  ON attendance_exceptions (status, exception_type, created_at DESC);
