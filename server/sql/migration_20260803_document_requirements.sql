ALTER TABLE document_requirements
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS document_requirements_active_order_idx
  ON document_requirements (is_active, sort_order, name);

INSERT INTO document_requirements (name, description, is_required, sort_order)
SELECT starter.name, starter.description, starter.is_required, starter.sort_order
FROM (VALUES
  ('Résumé', 'Current résumé or curriculum vitae for the host company.', true, 10),
  ('Application Letter', 'Signed application letter addressed to the host company.', true, 20),
  ('Parent or Guardian Consent', 'Signed consent form for participation in the OJT program.', true, 30),
  ('Medical Certificate', 'Current certification that the student is fit for training.', true, 40),
  ('Memorandum of Agreement', 'Applicable school and host-company agreement.', true, 50),
  ('Endorsement Letter', 'Official school endorsement for the student deployment.', true, 60),
  ('Daily Time Record', 'Final signed Daily Time Record for completion review.', true, 70),
  ('Narrative Report', 'Final narrative report describing the completed training.', true, 80),
  ('Supervisor Evaluation', 'Completed host-company supervisor evaluation.', true, 90),
  ('Certificate of Completion', 'Certificate issued by the host company after training.', true, 100)
) AS starter(name, description, is_required, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM document_requirements);
