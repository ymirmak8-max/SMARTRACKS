import express from 'express';
import {
  getRequirements,
  getStudentDocuments,
  uploadDocument,
  reviewDocument,
  createRequirement,
  updateRequirement,
  archiveRequirement,
} from '../controllers/documentController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken);

// Student routes
router.get('/requirements', authorize('student', 'coordinator'), getRequirements);
router.get('/my-documents', authorize('student'), getStudentDocuments);
router.post('/upload', authorize('student'), uploadDocument);

router.get('/student/:studentId', authorize('coordinator'), getStudentDocuments);
router.patch('/:docId/review', authorize('coordinator'), reviewDocument);
router.post('/requirements', authorize('coordinator'), createRequirement);
router.put('/requirements/:requirementId', authorize('coordinator'), updateRequirement);
router.patch('/requirements/:requirementId/archive', authorize('coordinator'), archiveRequirement);

export default router;
