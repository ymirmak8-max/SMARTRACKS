import crypto from 'node:crypto';
import pool from '../config/db.js';

export const createTemporaryPassword = () => `Tp!${crypto.randomBytes(9).toString('base64url')}`;

export const revokeUserSessions = async (userId) => {
  await pool.query(
    'UPDATE users SET token_version = COALESCE(token_version, 0) + 1, updated_at = NOW() WHERE id = $1',
    [userId]
  );
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
};

export const resolveFrontendUrl = (req) => {
  const configured = process.env.FRONTEND_URL || process.env.CLIENT_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  const origin = req?.get?.('origin') || req?.get?.('referer');
  if (origin) {
    try { return new URL(origin).origin; } catch { /* ignore */ }
  }
  if (process.env.NODE_ENV !== 'production') return 'http://localhost:5173';
  return null;
};
