import express from 'express';
import {
  getDeployedStudents,
  getStudentDetail,
  createAnnouncement,
  getAnnouncements,
  getAnomalyReport,
  getAttendanceReview,
  reviewAttendanceRecord,
} from '../controllers/coordinatorController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken);

// Coordinator/Admin only
router.get('/students', authorize('coordinator', 'admin'), getDeployedStudents);
router.get('/students/:studentId', authorize('coordinator', 'admin'), getStudentDetail);
router.get('/anomalies', authorize('coordinator', 'admin'), getAnomalyReport);
router.get('/attendance-review', authorize('coordinator', 'supervisor', 'admin'), getAttendanceReview);
router.patch('/attendance-review/:recordId', authorize('coordinator', 'supervisor', 'admin'), reviewAttendanceRecord);
router.post('/announcements', authorize('coordinator', 'admin'), createAnnouncement);

// All roles can view announcements
router.get('/announcements', getAnnouncements);

export default router;
