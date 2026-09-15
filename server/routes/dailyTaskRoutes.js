import express from 'express';
import {
  createDailyTask,
  excuseDailyTask,
  listStudentDailyTasks,
  listSupervisorDailyTasks,
  updateStudentDailyTask,
} from '../controllers/dailyTaskController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/mine', authorize('student'), listStudentDailyTasks);
router.patch('/:id', authorize('student'), updateStudentDailyTask);
router.get('/', authorize('supervisor'), listSupervisorDailyTasks);
router.post('/', authorize('supervisor'), createDailyTask);
router.patch('/:id/excuse', authorize('supervisor'), excuseDailyTask);

export default router;
