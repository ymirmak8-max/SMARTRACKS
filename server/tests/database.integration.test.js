import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from '../config/db.js';
import { authorizeStoredFile } from '../utils/storage.js';
import { enqueueNotification, processNotificationOutbox } from '../utils/notificationOutbox.js';
import { writeAuditLog } from '../utils/audit.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(testDatabaseUrl && process.env.DATABASE_URL === testDatabaseUrl && process.env.USE_PG_POOL === 'true');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
let ids = {};

before(async () => {
  if (!enabled) return;
  const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
  if (!/(^|_)test$/i.test(databaseName))
    throw new Error('Integration tests require a database name ending in "test".');

  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
  const schema = await fs.readFile(path.resolve(scriptDir, '../sql/schema.sql'), 'utf8');
  await pool.query(schema);

  const users = await pool.query(`
    INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, approval_status)
    VALUES
      ('Student', 'Owner', 'student@test.local', 'hash', 'student', true, 'approved'),
      ('Assigned', 'Coordinator', 'coordinator@test.local', 'hash', 'coordinator', true, 'approved'),
      ('Other', 'Coordinator', 'other@test.local', 'hash', 'coordinator', true, 'approved')
    RETURNING id, role, email
  `);
  ids.student = users.rows.find(row => row.role === 'student').id;
  ids.coordinator = users.rows.find(row => row.email === 'coordinator@test.local').id;
  ids.other = users.rows.find(row => row.email === 'other@test.local').id;
  const company = await pool.query("INSERT INTO companies (name) VALUES ('Test Company') RETURNING id");
  const deployment = await pool.query(`
    INSERT INTO deployments (student_id, coordinator_id, company_id)
    VALUES ($1, $2, $3) RETURNING id
  `, [ids.student, ids.coordinator, company.rows[0].id]);
  ids.deployment = deployment.rows[0].id;
});

after(async () => {
  if (enabled) await pool.end();
});

test('database authorization, constraints, audit, and notification retries work together', { skip: !enabled }, async () => {
  const requirement = await pool.query("INSERT INTO document_requirements (name) VALUES ('Resume') RETURNING id");
  await pool.query(`
    INSERT INTO student_documents (student_id, requirement_id, file_url, status)
    VALUES ($1, $2, '/api/files/test-file-token', 'pending')
  `, [ids.student, requirement.rows[0].id]);

  assert.equal(await authorizeStoredFile('test-file-token', { id: ids.student, role: 'student' }), true);
  assert.equal(await authorizeStoredFile('test-file-token', { id: ids.coordinator, role: 'coordinator' }), true);
  assert.equal(await authorizeStoredFile('test-file-token', { id: ids.other, role: 'coordinator' }), false);

  await assert.rejects(
    pool.query(`INSERT INTO student_documents (student_id, requirement_id, status) VALUES ($1, $2, 'pending')`,
      [ids.student, requirement.rows[0].id]),
    error => error.code === '23505'
  );

  await writeAuditLog({ actorId: ids.coordinator, action: 'integration.verify', entityType: 'deployment', entityId: ids.deployment });
  const audit = await pool.query("SELECT action FROM audit_logs WHERE action = 'integration.verify'");
  assert.equal(audit.rows.length, 1);

  const job = await enqueueNotification(ids.student, 'Test', 'Durable delivery', 'test');
  await processNotificationOutbox(async () => { throw new Error('temporary outage'); });
  let outbox = await pool.query('SELECT status, attempts, last_error FROM notification_outbox WHERE id = $1', [job.id]);
  assert.equal(outbox.rows[0].status, 'failed');
  assert.equal(outbox.rows[0].attempts, 1);
  assert.match(outbox.rows[0].last_error, /temporary outage/);

  await pool.query('UPDATE notification_outbox SET next_attempt_at = NOW() WHERE id = $1', [job.id]);
  await processNotificationOutbox(async () => {});
  outbox = await pool.query('SELECT status, attempts, delivered_at FROM notification_outbox WHERE id = $1', [job.id]);
  assert.equal(outbox.rows[0].status, 'delivered');
  assert.equal(outbox.rows[0].attempts, 2);
  assert.ok(outbox.rows[0].delivered_at);
});
