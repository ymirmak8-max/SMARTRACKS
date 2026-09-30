-- Convert leftover administrator accounts to coordinators.
-- The user_role enum keeps 'admin' so existing databases do not need a type rewrite.
UPDATE users SET role = 'coordinator' WHERE role = 'admin';

UPDATE deployments
SET coordinator_id = (
  SELECT id FROM users
  WHERE role = 'coordinator' AND is_active = true AND approval_status = 'approved'
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE coordinator_id IS NULL
  AND status = 'active'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE role = 'coordinator' AND is_active = true AND approval_status = 'approved'
  );
