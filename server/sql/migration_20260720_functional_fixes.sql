-- Apply this once to databases created from an older schema.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS course VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS school VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_approval_status_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_approval_status_check
      CHECK (approval_status IN ('pending', 'approved'));
  END IF;
END $$;

ALTER TABLE time_records ADD COLUMN IF NOT EXISTS evidence_url TEXT;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS evidence_note TEXT;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE time_records ADD COLUMN IF NOT EXISTS late_minutes INT NOT NULL DEFAULT 0;

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS work_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5];
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS work_start_time TIME NOT NULL DEFAULT '08:00';
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS work_end_time TIME NOT NULL DEFAULT '17:00';
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS late_grace_minutes INT NOT NULL DEFAULT 15;

ALTER TABLE document_requirements ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS student_locations (
    student_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    accuracy DECIMAL(8, 2),
    is_clocked_in BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_locations_updated_at_idx
ON student_locations (updated_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
ON password_reset_tokens (user_id);

-- Remove duplicate same-day rows before enabling this index if legacy data contains any.
CREATE UNIQUE INDEX IF NOT EXISTS time_records_student_date_unique
ON time_records (student_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS deployments_one_active_per_student
ON deployments (student_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS evaluations_deployment_period_unique
ON evaluations (deployment_id, period);

-- Existing duplicates must be resolved explicitly before this migration can safely continue.
CREATE UNIQUE INDEX IF NOT EXISTS student_documents_student_requirement_unique
ON student_documents (student_id, requirement_id);

CREATE INDEX IF NOT EXISTS deployments_coordinator_status_idx ON deployments (coordinator_id, status);
CREATE INDEX IF NOT EXISTS deployments_supervisor_status_idx ON deployments (supervisor_id, status);
CREATE INDEX IF NOT EXISTS time_records_student_date_idx ON time_records (student_id, date DESC);
CREATE INDEX IF NOT EXISTS student_documents_status_idx ON student_documents (status, submitted_at DESC);

CREATE TABLE IF NOT EXISTS attendance_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exception_type VARCHAR(20) NOT NULL CHECK (exception_type IN ('holiday', 'closure', 'leave', 'correction')),
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    reason TEXT NOT NULL,
    evidence_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    review_remarks TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS attendance_exceptions_student_dates_idx
ON attendance_exceptions (student_id, date_from, date_to);

CREATE INDEX IF NOT EXISTS attendance_exceptions_status_idx
ON attendance_exceptions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(64),
    user_agent VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'general',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'failed', 'delivered', 'dead')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx
ON notification_outbox (next_attempt_at, created_at)
WHERE status IN ('pending', 'failed', 'processing');

CREATE TABLE IF NOT EXISTS stored_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type VARCHAR(100) NOT NULL,
    content BYTEA NOT NULL,
    byte_size INT NOT NULL CHECK (byte_size > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stored_files_owner_created_idx
ON stored_files (owner_id, created_at DESC);
