import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import pool from '../config/db.js';

const file = process.argv[2] && path.resolve(process.argv[2]);
if (!file) throw new Error('Usage: npm run verify:backup -- <backup.dump>');
await fs.access(file);
const child = spawn('pg_restore', ['--list', file], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
let listing = '';
child.stdout.on('data', chunk => { listing += chunk; });
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
if (exitCode !== 0 || !listing.includes('TABLE DATA')) throw new Error('Backup verification failed.');
const stat = await fs.stat(file);
await pool.query(`
  INSERT INTO backup_verifications (file_name, byte_size, backup_created_at, status, details)
  VALUES ($1, $2, $3, 'verified', $4)
`, [path.basename(file), stat.size, stat.birthtime, 'pg_restore catalog validation passed']);
await pool.end();
console.log(`Backup structure verified: ${file}`);
