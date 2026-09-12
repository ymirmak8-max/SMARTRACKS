import express from 'express';
import { getProfile, updateProfile, changePassword } from '../controllers/profileController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/', getProfile);
router.put('/', updateProfile);
router.put('/change-password', changePassword);

export default router;
