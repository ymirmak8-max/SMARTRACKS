import { spawn } from 'node:child_process';
import fs from 'node:fs';
import pg from 'pg';
import 'dotenv/config';

const TEST_DATABASE_NAME = 'smartrack_security_test';
const baseUrl = process.env.DATABASE_URL || (
  process.env.DB_HOST && process.env.DB_USER
    ? `postgresql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASSWORD || '')}` +
      `@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'postgres'}`
    : null
);
if (!baseUrl) throw new Error('Database configuration is required to create the isolated test database.');

const ssl = process.env.DB_SSL === 'true' ? {
  rejectUnauthorized: true,
  ...(process.env.DB_SSL_CA_FILE ? { ca: fs.readFileSync(process.env.DB_SSL_CA_FILE, 'utf8') } : {}),
  ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
} : false;
const maintenanceUrl = new URL(baseUrl);
maintenanceUrl.pathname = '/postgres';
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${TEST_DATABASE_NAME}`;

const maintenance = new pg.Client({ connectionString: maintenanceUrl.toString(), ssl });
await maintenance.connect();
try {
  const existing = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DATABASE_NAME]);
  if (!existing.rows.length) await maintenance.query(`CREATE DATABASE ${TEST_DATABASE_NAME}`);
} finally {
  await maintenance.end();
}

const child = spawn(process.execPath, ['--test', '--test-concurrency=1'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testUrl.toString(),
    TEST_DATABASE_URL: testUrl.toString(),
  },
});
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
if (exitCode !== 0) process.exitCode = exitCode;
