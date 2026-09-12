import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL || (
  process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER
    ? `postgresql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASSWORD || '')}` +
      `@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME}`
    : null
);
if (!databaseUrl) throw new Error('DATABASE_URL or DB_HOST/DB_NAME/DB_USER is required.');
const backupDir = path.resolve(process.env.BACKUP_DIR || '../backups');
await fs.mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(backupDir, `smartrack-${stamp}.dump`);
const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', output, databaseUrl],
  { stdio: 'inherit', windowsHide: true });
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
if (exitCode !== 0) throw new Error(`pg_dump exited with code ${exitCode}.`);
const stat = await fs.stat(output);
if (stat.size < 1024) throw new Error('Backup was created but is unexpectedly small.');
console.log(`Backup created: ${output} (${stat.size} bytes)`);
