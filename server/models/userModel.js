import crypto from 'node:crypto';
import pool from '../config/db.js';

export const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const findUserByEmail = async (email) => {
  const result = await pool.query(
    `SELECT id, first_name, last_name, email, password_hash, role, phone, course, school,
            profile_picture, is_active, approval_status, mfa_enabled, token_version,
            privacy_notice_version, privacy_accepted_at, must_change_password
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [String(email || '').trim()]
  );
  return result.rows[0] || null;
};

export const findUserById = async (id) => {
  const result = await pool.query(
    `SELECT id, first_name, last_name, email, role, profile_picture, phone,
            course, school, approval_status, privacy_notice_version, privacy_accepted_at, mfa_enabled, token_version
     FROM users WHERE id = $1 AND is_active = true AND approval_status = 'approved'`,
    [id]
  );
  return result.rows[0] || null;
};

export const saveRefreshToken = async (userId, token, expiresAt) => {
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, hashRefreshToken(token), expiresAt]
  );
};

export const findRefreshToken = async (token) => {
  const result = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token IN ($1, $2) AND expires_at > NOW()',
    [hashRefreshToken(token), token]
  );
  return result.rows[0] || null;
};

export const deleteRefreshToken = async (token) => {
  await pool.query('DELETE FROM refresh_tokens WHERE token IN ($1, $2)', [hashRefreshToken(token), token]);
};

export const createUser = async ({ firstName, lastName, email, passwordHash, role }) => {
  const result = await pool.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role`,
    [firstName, lastName, email, passwordHash, role]
  );
  return result.rows[0];
};
