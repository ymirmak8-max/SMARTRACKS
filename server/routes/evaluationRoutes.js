import express from 'express';
import {
  submitEvaluation,
  getEvaluations,
  getStudentsForSupervisor,
} from '../controllers/evaluationController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken);

router.get('/my-students', authorize('supervisor'), getStudentsForSupervisor);
router.post('/submit', authorize('supervisor'), submitEvaluation);
router.get('/:deploymentId', authorize('supervisor', 'coordinator'), getEvaluations);

export default router;