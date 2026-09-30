import express from 'express';
import { getProfile, updateProfile, changePassword, uploadProfilePicture, removeProfilePicture } from '../controllers/profileController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/', getProfile);
router.put('/', updateProfile);
router.put('/picture', uploadProfilePicture);
router.delete('/picture', removeProfilePicture);
router.put('/change-password', changePassword);

export default router;
