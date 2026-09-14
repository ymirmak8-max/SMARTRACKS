-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ROLES ENUM
CREATE TYPE user_role AS ENUM ('admin', 'student', 'coordinator', 'supervisor');

-- USERS TABLE
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role user_role NOT NULL,
    is_active BOOLEAN DEFAULT true,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'
        CHECK (approval_status IN ('pending', 'approved')),
    profile_picture TEXT,
    phone VARCHAR(20),
    course VARCHAR(255),
    school VARCHAR(255),
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    privacy_notice_version VARCHAR(40),
    privacy_accepted_at TIMESTAMPTZ,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    mfa_secret TEXT,
    token_version INTEGER NOT NULL DEFAULT 0,
    notification_preferences JSONB NOT NULL
      DEFAULT '{"inApp":true,"email":true,"attendance":true,"documents":true,"announcements":true,"quietHoursStart":null,"quietHoursEnd":null}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- COMPANIES TABLE
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    geo_radius_meters INT DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;

CREATE TABLE company_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    geo_radius_meters INT NOT NULL DEFAULT 50 CHECK (geo_radius_meters BETWEEN 10 AND 5000),
    attendance_mode VARCHAR(20) NOT NULL DEFAULT 'fixed'
      CHECK (attendance_mode IN ('fixed', 'field', 'remote')),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, name)
);
CREATE UNIQUE INDEX company_locations_one_primary_idx ON company_locations (company_id) WHERE is_primary = true;

-- OJT DEPLOYMENTS (links student + supervisor + company)
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    supervisor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    coordinator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    primary_location_id UUID REFERENCES company_locations(id) ON DELETE SET NULL,
    required_hours INT NOT NULL DEFAULT 486,
    start_date DATE,
    end_date DATE,
    work_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
    work_start_time TIME NOT NULL DEFAULT '08:00',
    work_end_time TIME NOT NULL DEFAULT '17:00',
    late_grace_minutes INT NOT NULL DEFAULT 15,
    completion_status VARCHAR(30) NOT NULL DEFAULT 'in_progress'
      CHECK (completion_status IN ('in_progress', 'requested', 'approved', 'returned')),
    completion_requested_at TIMESTAMPTZ,
    completion_reviewed_at TIMESTAMPTZ,
    completion_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    completion_remarks TEXT,
    records_locked_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deployment_locations (
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES company_locations(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (deployment_id, location_id)
);
CREATE UNIQUE INDEX deployment_locations_one_primary_idx ON deployment_locations (deployment_id) WHERE is_primary = true;

-- TIME RECORDS (DTR)
CREATE TABLE time_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    clock_in TIMESTAMPTZ,
    clock_out TIMESTAMPTZ,
    clock_in_device_at TIMESTAMPTZ,
    clock_out_device_at TIMESTAMPTZ,
    clock_in_received_at TIMESTAMPTZ,
    clock_out_received_at TIMESTAMPTZ,
    clock_in_submission_id UUID,
    clock_out_submission_id UUID,
    clock_in_lat DECIMAL(10, 8),
    clock_in_lng DECIMAL(11, 8),
    clock_out_lat DECIMAL(10, 8),
    clock_out_lng DECIMAL(11, 8),
    clock_in_location_id UUID REFERENCES company_locations(id) ON DELETE SET NULL,
    clock_out_location_id UUID REFERENCES company_locations(id) ON DELETE SET NULL,
    selfie_in_url TEXT,
    selfie_out_url TEXT,
    evidence_url TEXT,
    evidence_note TEXT,
    is_valid BOOLEAN DEFAULT true,
    anomaly_flag TEXT,
    is_late BOOLEAN NOT NULL DEFAULT false,
    late_minutes INT NOT NULL DEFAULT 0,
    total_hours DECIMAL(5, 2),
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX deployments_one_active_per_student
ON deployments (student_id) WHERE status = 'active';

CREATE UNIQUE INDEX time_records_student_date_unique
ON time_records (student_id, date);

CREATE UNIQUE INDEX time_records_clock_in_submission_unique
ON time_records (clock_in_submission_id) WHERE clock_in_submission_id IS NOT NULL;

CREATE UNIQUE INDEX time_records_clock_out_submission_unique
ON time_records (clock_out_submission_id) WHERE clock_out_submission_id IS NOT NULL;

-- DOCUMENTS
CREATE TYPE doc_status AS ENUM ('not_submitted', 'pending', 'approved', 'returned');

CREATE TABLE document_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT true,
    deadline_days_before_ojt INT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE student_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    requirement_id UUID REFERENCES document_requirements(id) ON DELETE CASCADE,
    file_url TEXT,
    status doc_status DEFAULT 'not_submitted',
    remarks TEXT,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id)
);

-- EVALUATIONS
CREATE TABLE evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID REFERENCES deployments(id) ON DELETE CASCADE,
    supervisor_id UUID REFERENCES users(id),
    period VARCHAR(50) NOT NULL, -- 'midterm' or 'final'
    scores JSONB NOT NULL,       -- { "attitude": 90, "technical": 85, ... }
    total_score DECIMAL(5,2),
    comments TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- ANNOUNCEMENTS
CREATE TABLE announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by UUID REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    target_role user_role,        -- NULL = broadcast to all
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- REFRESH TOKENS
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE attendance_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(10) NOT NULL CHECK (action IN ('clock_in', 'clock_out')),
  token_hash CHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX attendance_challenges_student_idx ON attendance_challenges (student_id, expires_at DESC);

CREATE UNIQUE INDEX student_documents_student_requirement_unique
ON student_documents (student_id, requirement_id);

CREATE INDEX deployments_coordinator_status_idx ON deployments (coordinator_id, status);
CREATE INDEX deployments_supervisor_status_idx ON deployments (supervisor_id, status);
CREATE INDEX time_records_student_date_idx ON time_records (student_id, date DESC);
CREATE INDEX student_documents_status_idx ON student_documents (status, submitted_at DESC);

CREATE TABLE attendance_exceptions (
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
    proposed_clock_in TIME,
    proposed_clock_out TIME,
    original_record JSONB,
    applied_record_id UUID REFERENCES time_records(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (date_to >= date_from)
);

CREATE TABLE system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO system_settings (key, value) VALUES ('attendance_privacy', '{"imageRetentionDays":90}'::jsonb);
INSERT INTO system_settings (key, value) VALUES ('attendance_policy', '{"selfieRequired":true,"maximumGpsAccuracyMeters":100,"unpaidBreakMinutes":60,"maximumCreditedHours":8,"offlineSubmissionHours":24,"correctionApprover":"coordinator_or_admin"}'::jsonb);
INSERT INTO system_settings (key, value) VALUES ('privacy_notice', '{
  "version":"2026-07-28.2",
  "controllerName":"The school or institution operating this Smartrack deployment",
  "privacyContact":"Contact your school administrator or designated Data Protection Officer",
  "dataCategories":["Account and profile information","OJT deployment and company assignment","Time-in and time-out records","GPS coordinates and accuracy captured during attendance actions","Attendance selfie images and submitted evidence","Documents, evaluations, correction requests, notifications, and audit events","Device, IP address, and browser information recorded for security and auditing"],
  "purposes":["Administer OJT placements and required hours","Verify attendance at approved worksites","Review exceptions, documents, evaluations, and completion requests","Detect duplicate, inaccurate, late, or out-of-perimeter attendance","Maintain security, accountability, audit history, backups, and service reliability","Generate authorized reports and aggregate performance analytics"],
  "lawfulBasis":"The operating institution must document the applicable lawful basis for each processing purpose, such as performance of an educational or service relationship, compliance with a legal obligation, legitimate interests subject to a balancing assessment, or specific consent where consent is required.",
  "locationPurpose":"GPS is collected when an attendance action is performed and while an active timed-in session uses live-location monitoring. It is used to compare the device position with an approved worksite and identify exceptions.",
  "selfiePurpose":"Time-in and time-out selfies are attendance evidence. Smartrack does not perform facial recognition or biometric-template matching.",
  "recipients":["The student","Authorized Smartrack administrators","The student’s assigned coordinator and supervisor","Authorized service providers for hosting, storage, email, and notifications","Government or regulatory authorities only when disclosure is legally required"],
  "retention":"Account, OJT, attendance, evaluation, document, audit, and report records are retained according to the operating institution’s approved retention schedule and applicable requirements.",
  "imageRetentionDays":90,
  "automatedProcessing":"Smartrack calculates hours, distance, lateness, completion progress, and risk indicators using configured rules. Flags support human review and are not intended to make final disciplinary or academic decisions by themselves. Optional AI summaries may describe authorized aggregate or student performance data.",
  "security":"Safeguards include role-based access, password hashing, protected file links, encrypted transport when deployed over HTTPS, audit logging, rate limits, database constraints, backups, and configurable image deletion.",
  "rights":["Be informed","Request access","Request correction","Object when applicable","Withdraw consent where processing relies on consent","Request erasure or blocking when legally applicable","Obtain portable electronic data when applicable","Lodge a complaint with the National Privacy Commission"],
  "declining":"If you do not acknowledge this notice, Smartrack will not open the authenticated workspace. Contact the institution’s administrator or Data Protection Officer to ask about another attendance process, the applicable lawful basis, or the consequences of not using Smartrack.",
  "internationalProcessing":"Hosting and service providers may process data in locations selected by the operating institution. The institution must disclose applicable providers and cross-border safeguards.",
  "notConsent":"Acknowledging this notice confirms that it was presented to you. It is not blanket consent and does not waive any data-subject right."
}'::jsonb);

CREATE TABLE system_events (
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
CREATE INDEX system_events_created_idx ON system_events (created_at DESC);

CREATE UNIQUE INDEX evaluations_deployment_period_unique
ON evaluations (deployment_id, period);

CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);

-- Latest student position used by the live monitoring map
CREATE TABLE student_locations (
    student_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    accuracy DECIMAL(8, 2),
    is_clocked_in BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX student_locations_updated_at_idx
ON student_locations (updated_at DESC);

CREATE TABLE audit_logs (
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
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);

CREATE TABLE notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'general',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'failed', 'delivered', 'dead', 'suppressed')),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notification_outbox_pending_idx
ON notification_outbox (next_attempt_at, created_at)
WHERE status IN ('pending', 'failed', 'processing');

CREATE TABLE stored_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type VARCHAR(100) NOT NULL,
    content BYTEA NOT NULL,
    byte_size INT NOT NULL CHECK (byte_size > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX stored_files_owner_created_idx ON stored_files (owner_id, created_at DESC);

CREATE TABLE scheduled_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('dtr', 'analytics', 'evaluation')),
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('once', 'weekly', 'monthly')),
    delivery_email VARCHAR(255) NOT NULL,
    report_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    next_run_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    last_error TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scheduled_reports_email_check CHECK (delivery_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
CREATE INDEX scheduled_reports_user_id_idx ON scheduled_reports(user_id);
CREATE INDEX scheduled_reports_next_run_idx ON scheduled_reports(next_run_at) WHERE is_active = true;

CREATE TABLE backup_verifications (
    id BIGSERIAL PRIMARY KEY,
    file_name VARCHAR(500) NOT NULL,
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    backup_created_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL CHECK (status IN ('verified', 'failed')),
    details TEXT
);
CREATE INDEX backup_verifications_verified_idx ON backup_verifications (verified_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION revoke_user_sessions_on_security_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_active IS DISTINCT FROM NEW.is_active
     OR OLD.role IS DISTINCT FROM NEW.role
     OR OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    NEW.token_version = OLD.token_version + 1;
    DELETE FROM refresh_tokens WHERE user_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER revoke_user_sessions_security_change
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION revoke_user_sessions_on_security_change();

CREATE TRIGGER update_scheduled_reports_updated_at
BEFORE UPDATE ON scheduled_reports
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
