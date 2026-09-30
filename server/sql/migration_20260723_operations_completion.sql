CREATE TABLE IF NOT EXISTS system_events (
  id BIGSERIAL PRIMARY KEY,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'error')),
  category VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  method VARCHAR(10),
  path TEXT,
  status_code INT,
  duration_ms INT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS system_events_created_idx ON system_events (created_at DESC);

INSERT INTO system_settings (key, value)
VALUES ('attendance_policy', '{
  "selfieRequired": true,
  "maximumGpsAccuracyMeters": 100,
  "unpaidBreakMinutes": 60,
  "maximumCreditedHours": 8,
  "offlineSubmissionHours": 24,
  "correctionApprover": "coordinator_or_admin"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS completion_status VARCHAR(30) NOT NULL DEFAULT 'in_progress'
    CHECK (completion_status IN ('in_progress', 'requested', 'approved', 'returned')),
  ADD COLUMN IF NOT EXISTS completion_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_remarks TEXT,
  ADD COLUMN IF NOT EXISTS records_locked_at TIMESTAMPTZ;
