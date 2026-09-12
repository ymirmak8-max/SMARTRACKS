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
router.get('/requirements', authorize('student', 'coordinator', 'admin'), getRequirements);
router.get('/my-documents', authorize('student'), getStudentDocuments);
router.post('/upload', authorize('student'), uploadDocument);

// Coordinator/Admin routes
router.get('/student/:studentId', authorize('coordinator', 'admin'), getStudentDocuments);
router.patch('/:docId/review', authorize('coordinator', 'admin'), reviewDocument);
router.post('/requirements', authorize('admin', 'coordinator'), createRequirement);
router.put('/requirements/:requirementId', authorize('admin', 'coordinator'), updateRequirement);
router.patch('/requirements/:requirementId/archive', authorize('admin', 'coordinator'), archiveRequirement);

export default router;
