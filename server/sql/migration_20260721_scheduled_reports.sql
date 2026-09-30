CREATE TABLE IF NOT EXISTS scheduled_reports (
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

CREATE INDEX IF NOT EXISTS scheduled_reports_user_id_idx ON scheduled_reports(user_id);
CREATE INDEX IF NOT EXISTS scheduled_reports_next_run_idx ON scheduled_reports(next_run_at) WHERE is_active = true;

CREATE OR REPLACE FUNCTION update_scheduled_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_scheduled_reports_updated_at ON scheduled_reports;
CREATE TRIGGER trigger_scheduled_reports_updated_at
BEFORE UPDATE ON scheduled_reports
FOR EACH ROW EXECUTE FUNCTION update_scheduled_reports_updated_at();
