ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS attendance_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(10) NOT NULL CHECK (action IN ('clock_in', 'clock_out')),
  token_hash CHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS attendance_challenges_student_idx
ON attendance_challenges (student_id, expires_at DESC);

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

DROP TRIGGER IF EXISTS revoke_user_sessions_security_change ON users;
CREATE TRIGGER revoke_user_sessions_security_change
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION revoke_user_sessions_on_security_change();

ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_status_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_status_check
  CHECK (status IN ('pending', 'processing', 'failed', 'delivered', 'dead', 'suppressed'));
