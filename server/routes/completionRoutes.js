import express from 'express';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';
import {
  getCompletionQueue, getMyCompletion, requestCompletion, reviewCompletion,
} from '../controllers/completionController.js';

const router = express.Router();
router.use(verifyToken);
router.get('/mine', authorize('student'), getMyCompletion);
router.post('/request', authorize('student'), requestCompletion);
router.get('/queue', authorize('coordinator'), getCompletionQueue);
router.patch('/:id/review', authorize('coordinator'), reviewCompletion);
export default router;
