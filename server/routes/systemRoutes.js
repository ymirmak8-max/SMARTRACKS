import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  getAttendancePolicy, getBackupStatus, getOperationalEvents, getPrivacySettings, getSystemHealth,
  runImageCleanup, updateAttendancePolicy, updatePrivacySettings,
} from '../controllers/systemController.js';

const router = express.Router();
router.get('/health', verifyToken, authorize('coordinator'), getSystemHealth);
router.get('/privacy', verifyToken, authorize('coordinator'), getPrivacySettings);
router.put('/privacy', verifyToken, authorize('coordinator'), updatePrivacySettings);
router.post('/privacy/cleanup', verifyToken, authorize('coordinator'), runImageCleanup);
router.get('/events', verifyToken, authorize('coordinator'), getOperationalEvents);
router.get('/backups', verifyToken, authorize('coordinator'), getBackupStatus);
router.get('/attendance-policy', verifyToken, authorize('coordinator'), getAttendancePolicy);
router.put('/attendance-policy', verifyToken, authorize('coordinator'), updateAttendancePolicy);
export default router;
