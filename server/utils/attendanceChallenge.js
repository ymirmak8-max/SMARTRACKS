import crypto from 'node:crypto';
import pool from '../config/db.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export const issueAttendanceChallenge = async (studentId, action) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO attendance_challenges (student_id, action, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [studentId, action, hash(token), expiresAt]
  );
  return { token, expiresAt: expiresAt.toISOString() };
};

export const consumeAttendanceChallenge = async (studentId, action, token) => {
  if (!token) return false;
  const result = await pool.query(`
    UPDATE attendance_challenges SET used_at = NOW()
    WHERE student_id = $1 AND action = $2 AND token_hash = $3
      AND used_at IS NULL AND expires_at > NOW()
    RETURNING id
  `, [studentId, action, hash(token)]);
  return result.rows.length > 0;
};
