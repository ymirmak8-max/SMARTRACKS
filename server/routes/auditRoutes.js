import express from 'express';
import { getAuditLogs } from '../controllers/auditController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken, authorize('admin'));

router.get('/', getAuditLogs);

export default router;
