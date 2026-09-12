import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, tokenVersion: Number(user.token_version || 0) },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

export const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString('hex');
};
