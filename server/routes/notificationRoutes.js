import express from 'express';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  createNotification,
  getOutboxStatus,
  retryOutboxNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
  getPushPublicConfig,
  subscribePush,
  unsubscribePush,
} from '../controllers/notificationController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/', getNotifications);
router.get('/preferences', getNotificationPreferences);
router.put('/preferences', updateNotificationPreferences);
router.get('/push/config', getPushPublicConfig);
router.post('/push/subscribe', subscribePush);
router.delete('/push/subscribe', unsubscribePush);
router.get('/outbox/status', authorize('coordinator'), getOutboxStatus);
router.post('/outbox/:id/retry', authorize('coordinator'), retryOutboxNotification);
router.patch('/read-all', markAllAsRead);
router.patch('/:id/read', markAsRead);
router.post('/', authorize('coordinator'), createNotification);

export default router;
