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
  const adminCount = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
  const count = Number(adminCount.rows[0]?.count) || 0;
  if (count === 0) {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password || password.length < 12)
      throw new Error('A new database requires BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters.');
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, approval_status, must_change_password)
       VALUES ('System', 'Administrator', $1, $2, 'admin', true, 'approved', false)`,
      [email, passwordHash]
    );
    console.log('Initial administrator created. Remove the bootstrap password environment variable after first deployment.');
  } else {
    console.log('Database is reachable over Supabase HTTPS. Administrator already exists.');
  }
} catch (error) {
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
