import express from 'express';
import {
  getRequirements,
  getStudentDocuments,
  uploadDocument,
  reviewDocument,
  deleteDocumentFile,
  createRequirement,
  updateRequirement,
  archiveRequirement,
  deleteRequirement,
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
router.delete('/:docId/file', authorize('coordinator'), deleteDocumentFile);
router.post('/requirements', authorize('coordinator'), createRequirement);
router.put('/requirements/:requirementId', authorize('coordinator'), updateRequirement);
router.patch('/requirements/:requirementId/archive', authorize('coordinator'), archiveRequirement);
router.delete('/requirements/:requirementId', authorize('coordinator'), deleteRequirement);

export default router;
