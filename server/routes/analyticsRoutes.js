import express from 'express';
import { getStudentAnalytics, getOverviewAnalytics, getRiskDashboard } from '../controllers/analyticsController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.get('/overview', authorize('coordinator'), getOverviewAnalytics);
router.get('/risks', authorize('coordinator'), getRiskDashboard);
router.get('/student/:id', authorize('coordinator', 'supervisor'), getStudentAnalytics);

export default router;
