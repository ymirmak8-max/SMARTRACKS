import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { isFlagEnabled } from '../utils/flags.js';
import { toAppRole } from '../utils/roles.js';

const isAllowedBeforePrivacyAcknowledgement = req =>
  req.baseUrl === '/api/auth' && ['/privacy/accept', '/privacy-notice', '/logout', '/me'].includes(req.path);

export const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Access token required.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(`
      SELECT u.id, u.email, u.role, u.is_active, u.approval_status, u.mfa_enabled,
             u.token_version, u.privacy_notice_version,
             settings.value->>'version' AS current_privacy_version
      FROM users u
      LEFT JOIN system_settings settings ON settings.key = 'privacy_notice'
      WHERE u.id = $1
    `, [decoded.id]);
    const user = result.rows[0];
    if (!user || !isFlagEnabled(user.is_active) || user.approval_status !== 'approved')
      return res.status(401).json({ message: 'This account is no longer active.' });
    if (Number(decoded.tokenVersion || 0) !== Number(user.token_version || 0))
      return res.status(401).json({ message: 'Your session has been revoked. Sign in again.' });

    const role = toAppRole(user.role);
    req.user = { ...decoded, id: user.id, email: user.email, role,
      mfaEnabled: isFlagEnabled(user.mfa_enabled) };
    if (user.current_privacy_version && user.privacy_notice_version !== user.current_privacy_version
      && !isAllowedBeforePrivacyAcknowledgement(req))
      return res.status(428).json({ code: 'PRIVACY_NOTICE_REQUIRED',
        message: 'Review and acknowledge the current privacy notice before continuing.' });
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};
