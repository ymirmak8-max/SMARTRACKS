CREATE TABLE IF NOT EXISTS daily_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  task_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES daily_task_templates(id) ON DELETE CASCADE,
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'missing'
    CHECK (status IN ('missing', 'in_progress', 'completed', 'excused')),
  student_notes TEXT,
  completed_at TIMESTAMPTZ,
  excused_by UUID REFERENCES users(id) ON DELETE SET NULL,
  excused_at TIMESTAMPTZ,
  excuse_remarks TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, student_id)
);

CREATE INDEX IF NOT EXISTS daily_task_templates_supervisor_date_idx
  ON daily_task_templates (supervisor_id, task_date DESC);
CREATE INDEX IF NOT EXISTS daily_task_assignments_student_idx
  ON daily_task_assignments (student_id, status);
CREATE INDEX IF NOT EXISTS daily_task_assignments_deployment_idx
  ON daily_task_assignments (deployment_id);
