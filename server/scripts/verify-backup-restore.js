import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';

const file = process.argv[2] && path.resolve(process.argv[2]);
const restoreUrl = process.env.RESTORE_VERIFY_DATABASE_URL;
if (!file || !restoreUrl)
  throw new Error('Usage: set RESTORE_VERIFY_DATABASE_URL to an isolated database, then run npm run verify:restore -- <backup.dump>');
await fs.access(file);
const databaseName = new URL(restoreUrl).pathname.replace(/^\//, '');
if (!/(restore|recovery).*(test|verify)|(test|verify).*(restore|recovery)/i.test(databaseName))
  throw new Error('Safety check failed: the restore database name must clearly contain restore/recovery and test/verify.');

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
});

const target = new pg.Pool({
  connectionString: restoreUrl,
  ssl: process.env.RESTORE_DB_SSL === 'true' ? { rejectUnauthorized: true,
    ...(process.env.RESTORE_DB_SSL_CA ? { ca: process.env.RESTORE_DB_SSL_CA.replace(/\\n/g, '\n') } : {}) } : false,
});
try {
  await target.query('DROP SCHEMA public CASCADE');
  await target.query('CREATE SCHEMA public');
  await run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', restoreUrl, file]);
  const result = await target.query(`
    SELECT
      to_regclass('public.users') IS NOT NULL AS users_exists,
      to_regclass('public.time_records') IS NOT NULL AS time_records_exists,
      (SELECT COUNT(*)::int FROM users) AS user_count
  `);
  if (!result.rows[0]?.users_exists || !result.rows[0]?.time_records_exists)
    throw new Error('Restored database is missing required application tables.');
  console.log(`Backup restore verified in isolated database ${databaseName}; users=${result.rows[0].user_count}.`);
} finally {
  await target.end();
}
