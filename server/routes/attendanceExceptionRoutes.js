import express from 'express';
import { authorize } from '../middleware/roleMiddleware.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import {
  createCalendarException, createRequest, getCalendarExceptions, getMyExceptions,
  getReviewQueue, reviewRequest,
} from '../controllers/attendanceExceptionController.js';

const router = express.Router();
router.use(verifyToken);
router.get('/mine', authorize('student'), getMyExceptions);
router.post('/requests', authorize('student'), createRequest);
router.get('/requests', authorize('coordinator'), getReviewQueue);
router.patch('/requests/:id/review', authorize('coordinator'), reviewRequest);
router.get('/calendar', authorize('coordinator'), getCalendarExceptions);
router.post('/calendar', authorize('coordinator'), createCalendarException);

export default router;
