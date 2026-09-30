import express from 'express';
import {
  createWorkplace,
  getStudentActivity,
  getWorkplaces,
  removeWorkplace,
  updateWorkplace,
} from '../controllers/supervisorController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken, authorize('supervisor'));

router.get('/workplaces', getWorkplaces);
router.post('/workplaces', createWorkplace);
router.put('/workplaces/:id', updateWorkplace);
router.delete('/workplaces/:id', removeWorkplace);
router.get('/students/:studentId/activity', getStudentActivity);

export default router;
