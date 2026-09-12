import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import 'dotenv/config';

const databaseName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname : process.env.DB_NAME || '';
if (process.env.APP_ENV !== 'staging' || !/(staging|test)/i.test(databaseName))
  throw new Error('Refusing to seed: APP_ENV must be staging and the database name must contain staging or test.');
const password = process.env.STAGING_SEED_PASSWORD;
if (!password || password.length < 12) throw new Error('STAGING_SEED_PASSWORD must contain at least 12 characters.');

const passwordHash = await bcrypt.hash(password, 12);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const users = [
    ['Staging', 'Admin', 'admin@staging.smartrack.test', 'admin'],
    ['Staging', 'Coordinator', 'coordinator@staging.smartrack.test', 'coordinator'],
    ['Staging', 'Supervisor', 'supervisor@staging.smartrack.test', 'supervisor'],
    ['Staging', 'Student', 'student@staging.smartrack.test', 'student'],
  ];
  const ids = {};
  for (const [first, last, email, role] of users) {
    const result = await client.query(`
      INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, approval_status)
      VALUES ($1, $2, $3, $4, $5, true, 'approved')
      ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, is_active = true, approval_status = 'approved'
      RETURNING id
    `, [first, last, email, passwordHash, role]);
    ids[role] = result.rows[0].id;
  }
  const company = await client.query(`
    INSERT INTO companies (name, address, latitude, longitude, geo_radius_meters)
    SELECT 'Smartrack Staging Company', 'Staging data only', 10.3157, 123.8854, 150
    WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Smartrack Staging Company')
    RETURNING id
  `);
  const companyId = company.rows[0]?.id || (await client.query(
    "SELECT id FROM companies WHERE name = 'Smartrack Staging Company'"
  )).rows[0].id;
  await client.query(`
    INSERT INTO deployments (student_id, coordinator_id, supervisor_id, company_id, required_hours, start_date, status)
    VALUES ($1, $2, $3, $4, 486, CURRENT_DATE, 'active')
    ON CONFLICT (student_id) WHERE status = 'active' DO NOTHING
  `, [ids.student, ids.coordinator, ids.supervisor, companyId]);
  await client.query('COMMIT');
  console.log('Staging accounts and sample deployment are ready.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
