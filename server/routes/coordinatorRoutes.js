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

router.get('/students', authorize('coordinator'), getDeployedStudents);
router.get('/students/:studentId', authorize('coordinator'), getStudentDetail);
router.get('/anomalies', authorize('coordinator'), getAnomalyReport);
router.get('/attendance-review', authorize('coordinator', 'supervisor'), getAttendanceReview);
router.patch('/attendance-review/:recordId', authorize('coordinator', 'supervisor'), reviewAttendanceRecord);
router.post('/announcements', authorize('coordinator'), createAnnouncement);

// All roles can view announcements
router.get('/announcements', getAnnouncements);

export default router;
