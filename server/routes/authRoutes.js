import express from 'express';
import {
  login, register, refreshAccessToken, logout, getMe, forgotPassword, resetPassword,
  verifyMfaLogin, beginMfaSetup, confirmMfaSetup, disableMfa, getPrivacyNotice, acceptPrivacyNotice,
} from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', register);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/login', login);
router.post('/mfa/verify', verifyMfaLogin);
router.post('/refresh', refreshAccessToken);
router.post('/logout', logout);
router.get('/me', verifyToken, getMe);
router.get('/privacy-notice', getPrivacyNotice);
router.post('/privacy/accept', verifyToken, acceptPrivacyNotice);
router.post('/mfa/setup', verifyToken, beginMfaSetup);
router.post('/mfa/confirm', verifyToken, confirmMfaSetup);
router.delete('/mfa', verifyToken, disableMfa);

export default router;
