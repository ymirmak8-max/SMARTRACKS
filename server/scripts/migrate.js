import dotenv from 'dotenv';
import pool from '../config/db.js';
import bcrypt from 'bcrypt';

dotenv.config();

try {
  await pool.query('SELECT 1 AS ok');
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS users_company_id_idx ON users (company_id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stored_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime_type VARCHAR(100) NOT NULL,
      content BYTEA NOT NULL,
      byte_size INT NOT NULL CHECK (byte_size > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS stored_files_owner_created_idx ON stored_files (owner_id, created_at DESC)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_task_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supervisor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      task_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
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
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS daily_task_templates_supervisor_date_idx ON daily_task_templates (supervisor_id, task_date DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS daily_task_assignments_student_idx ON daily_task_assignments (student_id, status)');
  await pool.query(`
    UPDATE system_settings
    SET value = jsonb_set(value, '{maximumGpsAccuracyMeters}', '100'::jsonb),
        updated_at = NOW()
    WHERE key = 'attendance_policy'
      AND COALESCE((value->>'maximumGpsAccuracyMeters')::numeric, 50) < 100
  `);
  const converted = await pool.query("UPDATE users SET role = 'coordinator' WHERE role = 'admin' RETURNING id");
  if (converted.rows.length > 0)
    console.log(`Converted ${converted.rows.length} administrator account(s) to coordinator.`);
  const coordinatorCount = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'coordinator'");
  const count = Number(coordinatorCount.rows[0]?.count) || 0;
  if (count === 0) {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password || password.length < 12)
      throw new Error('A new database requires BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters.');
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, approval_status, must_change_password)
       VALUES ('System', 'Coordinator', $1, $2, 'coordinator', true, 'approved', false)`,
      [email, passwordHash]
    );
    console.log('Initial coordinator created. Remove the bootstrap password environment variable after first deployment.');
  } else {
    console.log('Database is reachable over Supabase HTTPS. Coordinator already exists.');
  }
} catch (error) {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
