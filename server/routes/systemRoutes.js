import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  getAttendancePolicy, getBackupStatus, getOperationalEvents, getPrivacySettings, getSystemHealth,
  runImageCleanup, updateAttendancePolicy, updatePrivacySettings,
} from '../controllers/systemController.js';

const router = express.Router();
router.get('/health', verifyToken, authorize('admin'), getSystemHealth);
router.get('/privacy', verifyToken, authorize('admin'), getPrivacySettings);
router.put('/privacy', verifyToken, authorize('admin'), updatePrivacySettings);
router.post('/privacy/cleanup', verifyToken, authorize('admin'), runImageCleanup);
router.get('/events', verifyToken, authorize('admin'), getOperationalEvents);
router.get('/backups', verifyToken, authorize('admin'), getBackupStatus);
router.get('/attendance-policy', verifyToken, authorize('admin'), getAttendancePolicy);
router.put('/attendance-policy', verifyToken, authorize('admin'), updateAttendancePolicy);
export default router;
