import bcrypt from 'bcrypt';
import crypto from 'crypto';
import pool from '../config/db.js';
import {
  findUserByEmail,
  findUserById,
  saveRefreshToken,
  findRefreshToken,
  deleteRefreshToken,
} from '../models/userModel.js';
import { generateAccessToken, generateRefreshToken } from '../utils/generateToken.js';
import { sendPasswordResetEmail } from '../utils/sendEmail.js';
import { writeAuditLog } from '../utils/audit.js';
import jwt from 'jsonwebtoken';
import { buildOtpAuthUrl, createMfaSecret, decryptMfaSecret, encryptMfaSecret, verifyTotp } from '../utils/mfa.js';
import { isFlagEnabled } from '../utils/flags.js';
import { sanitizePhone } from '../utils/phone.js';
import { resolveFrontendUrl, revokeUserSessions } from '../utils/authSession.js';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.COOKIE_SAME_SITE || 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const serializeUser = (user) => ({
  id: user.id,
  first_name: user.first_name,
  last_name: user.last_name,
  firstName: user.first_name,
  lastName: user.last_name,
  email: user.email,
  role: String(user.role || '').trim().toLowerCase(),
  phone: user.phone,
  course: user.course,
  school: user.school,
  profile_picture: user.profile_picture,
  profilePicture: user.profile_picture,
  approvalStatus: user.approval_status,
  privacyNoticeVersion: user.privacy_notice_version,
  privacyAcceptedAt: user.privacy_accepted_at,
  mfaEnabled: isFlagEnabled(user.mfa_enabled),
});

const issueSession = async (user, res) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  await saveRefreshToken(user.id, refreshToken, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
  return { accessToken, user: serializeUser(user) };
};

// POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' });

    const user = await findUserByEmail(email);
    if (!user)
      return res.status(401).json({ message: 'Invalid credentials.' });

    if (user.approval_status === 'pending')
      return res.status(403).json({ message: 'Your registration is awaiting administrator approval.' });

    if (!isFlagEnabled(user.is_active))
      return res.status(403).json({ message: 'Your account is inactive. Please contact the administrator.' });

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch)
      return res.status(401).json({ message: 'Invalid credentials.' });

    if (isFlagEnabled(user.mfa_enabled)) {
      const challengeToken = jwt.sign(
        { id: user.id, purpose: 'mfa-login' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.status(202).json({ mfaRequired: true, challengeToken });
    }
    const session = await issueSession(user, res);
    await writeAuditLog({ actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, req });

    return res.status(200).json(session);
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error during login.' });
  }
};

// POST /api/auth/register
export const register = async (req, res) => {
  try {
    const { firstName, lastName, email, password, phone, course, school } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    if (!firstName || !lastName || !normalizedEmail || !password)
      return res.status(400).json({ message: 'All fields are required.' });

    if (password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    // Validate email format strictly
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
if (!emailRegex.test(normalizedEmail))
  return res.status(400).json({ message: 'Please enter a valid email address.' });

// Block disposable/dump email domains
const blockedDomains = [
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'guerrillamail.info', 'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.net',
  'guerrillamail.org', 'spam4.me', 'trashmail.com', 'trashmail.me', 'trashmail.net',
  'dispostable.com', 'mailnull.com', 'maildrop.cc', 'fakeinbox.com',
  'temp-mail.org', 'tempinbox.com', 'discard.email', 'mailnesia.com',
  'mailnull.com', 'spamgourmet.com', 'trashmail.at', 'trashmail.io',
  'getnada.com', 'mohmal.com', 'tempr.email', 'dispostable.com',
];

const emailDomain = normalizedEmail.split('@')[1];
if (blockedDomains.includes(emailDomain))
  return res.status(400).json({ message: 'Please use a valid school or personal email address.' });

    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ message: 'Email already in use.' });

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, phone, course, school, is_active, approval_status, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'pending', false)
       RETURNING id, first_name, last_name, email, role, approval_status`,
      [firstName.trim(), lastName.trim(), normalizedEmail, passwordHash, 'student', sanitizePhone(phone), course || null, school || null]
    );

    await writeAuditLog({ actorId: result.rows[0].id, action: 'auth.register', entityType: 'user',
      entityId: result.rows[0].id, details: { approvalStatus: 'pending' }, req });
    const { notifyStudentReady } = await import('../utils/staffNotify.js');
    notifyStudentReady({
      firstName: result.rows[0].first_name,
      lastName: result.rows[0].last_name,
      source: 'register',
    }).catch(error => console.error('Student registration notify error:', error.message));

    return res.status(201).json({
      message: 'Registration submitted. An administrator must approve your account before you can sign in.',
      user: result.rows[0],
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'Server error during registration.' });
  }
};

// POST /api/auth/refresh
export const refreshAccessToken = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token)
      return res.status(401).json({ message: 'No refresh token provided.' });

    const stored = await findRefreshToken(token);
    if (!stored)
      return res.status(403).json({ message: 'Invalid or expired refresh token.' });

    const user = await findUserById(stored.user_id);
    if (!user)
      return res.status(403).json({ message: 'User not found.' });

    await deleteRefreshToken(token);
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await saveRefreshToken(user.id, refreshToken, expiresAt);

    const accessToken = generateAccessToken(user);
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
    return res.status(200).json({ accessToken });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ message: 'Server error during token refresh.' });
  }
};

// POST /api/auth/logout
export const logout = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (token) await deleteRefreshToken(token);
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    });
    return res.status(200).json({ message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ message: 'Server error during logout.' });
  }
};

// GET /api/auth/me
export const getMe = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    return res.status(200).json({ user: serializeUser(user) });
  } catch (err) {
    return res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/auth/forgot-password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ message: 'Email is required.' });

    const result = await pool.query(
      'SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true',
      [email.trim()]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [user.id, tokenHash]
      );

      await writeAuditLog({ actorId: user.id, action: 'password_reset.request', entityType: 'user',
        entityId: user.id, req });

      const frontendUrl = resolveFrontendUrl(req);
      const resetUrl = frontendUrl ? `${frontendUrl}/reset-password?token=${token}` : null;
      let emailSent = false;
      if (resetUrl) {
        try {
          await sendPasswordResetEmail({ to: user.email, resetUrl });
          emailSent = true;
        } catch (emailError) {
          console.error('Password reset email error:', emailError.message);
        }
      } else {
        console.error('Password reset email error: FRONTEND_URL or CLIENT_URL is not configured.');
      }

      const payload = {
        message: 'If an account exists with this email, reset instructions have been sent.',
        emailSent,
      };
      if (!emailSent && process.env.NODE_ENV !== 'production' && resetUrl)
        payload.resetUrl = resetUrl;
      return res.status(200).json(payload);
    }

    return res.status(200).json({
      message: 'If an account exists with this email, reset instructions have been sent.',
      emailSent: false,
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

export const verifyMfaLogin = async (req, res) => {
  try {
    const { challengeToken, code } = req.body;
    const challenge = jwt.verify(challengeToken, process.env.JWT_SECRET);
    if (challenge.purpose !== 'mfa-login') throw new Error('Invalid challenge.');
    const result = await pool.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [challenge.id]);
    const user = result.rows[0];
    if (!user?.mfa_enabled || !verifyTotp(decryptMfaSecret(user.mfa_secret), code))
      return res.status(401).json({ message: 'The verification code is invalid or expired.' });
    const session = await issueSession(user, res);
    await writeAuditLog({ actorId: user.id, action: 'auth.mfa_login', entityType: 'user', entityId: user.id, req });
    return res.status(200).json(session);
  } catch {
    return res.status(401).json({ message: 'The MFA challenge is invalid or expired.' });
  }
};

export const beginMfaSetup = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (String(user.role || '').trim().toLowerCase() !== 'admin')
      return res.status(403).json({ message: 'MFA setup is restricted to administrators.' });
    const secret = createMfaSecret();
    await pool.query('UPDATE users SET mfa_secret = $1, mfa_enabled = false WHERE id = $2',
      [encryptMfaSecret(secret), user.id]);
    return res.status(200).json({ secret, otpAuthUrl: buildOtpAuthUrl({ email: user.email, secret }) });
  } catch {
    return res.status(500).json({ message: 'Unable to begin MFA setup.' });
  }
};

export const confirmMfaSetup = async (req, res) => {
  try {
    const result = await pool.query('SELECT mfa_secret, role FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (user?.role !== 'admin' || !user.mfa_secret || !verifyTotp(decryptMfaSecret(user.mfa_secret), req.body.code))
      return res.status(400).json({ message: 'The verification code is invalid.' });
    await pool.query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user.id]);
    await writeAuditLog({ actorId: req.user.id, action: 'auth.mfa_enable', entityType: 'user', entityId: req.user.id, req });
    return res.status(200).json({ message: 'Multi-factor authentication enabled.' });
  } catch {
    return res.status(500).json({ message: 'Unable to enable MFA.' });
  }
};

export const disableMfa = async (req, res) => {
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows[0] || !await bcrypt.compare(req.body.password || '', result.rows[0].password_hash))
      return res.status(401).json({ message: 'Your password is incorrect.' });
    await pool.query('UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1', [req.user.id]);
    await writeAuditLog({ actorId: req.user.id, action: 'auth.mfa_disable', entityType: 'user', entityId: req.user.id, req });
    return res.status(200).json({ message: 'Multi-factor authentication disabled.' });
  } catch {
    return res.status(500).json({ message: 'Unable to disable MFA.' });
  }
};

export const getPrivacyNotice = async (_req, res) => {
  const result = await pool.query("SELECT value FROM system_settings WHERE key = 'privacy_notice'");
  return res.status(200).json({ notice: result.rows[0]?.value || { version: '2026-07-28' } });
};

export const acceptPrivacyNotice = async (req, res) => {
  const notice = await pool.query("SELECT value FROM system_settings WHERE key = 'privacy_notice'");
  const version = notice.rows[0]?.value?.version;
  if (!version || req.body.version !== version)
    return res.status(409).json({ message: 'The privacy notice has changed. Review the latest version.' });
  await pool.query('UPDATE users SET privacy_notice_version = $1, privacy_accepted_at = NOW() WHERE id = $2',
    [version, req.user.id]);
  await writeAuditLog({ actorId: req.user.id, action: 'privacy.notice_acknowledge', entityType: 'user',
    entityId: req.user.id, details: { version }, req });
  return res.status(200).json({ version, acknowledgedAt: new Date().toISOString() });
};

// POST /api/auth/reset-password
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ message: 'Token and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      `DELETE FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW()
       RETURNING user_id`,
      [tokenHash]
    );
    if (result.rows.length === 0)
      return res.status(400).json({ message: 'Reset link is invalid or expired.' });

    const userId = result.rows[0].user_id;
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2`,
      [passwordHash, userId]
    );
    await revokeUserSessions(userId);
    await writeAuditLog({ actorId: userId, action: 'password_reset.complete', entityType: 'user',
      entityId: userId, req });
    return res.status(200).json({ message: 'Password reset successfully.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ message: 'Failed to reset password.' });
  }
};
