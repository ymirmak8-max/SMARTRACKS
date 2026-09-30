import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { toAppRole } from './roles.js';

export const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, role: toAppRole(user.role), email: user.email, tokenVersion: Number(user.token_version || 0) },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

export const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString('hex');
};
