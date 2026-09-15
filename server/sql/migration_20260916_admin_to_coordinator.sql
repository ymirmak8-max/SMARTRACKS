-- Convert leftover administrator accounts to coordinators.
-- The user_role enum keeps 'admin' so existing databases do not need a type rewrite.
UPDATE users SET role = 'coordinator' WHERE role = 'admin';
