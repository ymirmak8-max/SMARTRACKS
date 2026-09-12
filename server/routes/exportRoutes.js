import express from 'express';
import {
  exportDTRCSV,
  exportAnalyticsCSV,
  scheduleReportExport,
  getScheduledReports,
  deleteScheduledReport,
  streamExportData,
} from '../controllers/exportController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(verifyToken);

/**
 * Export routes for server-side data export and scheduling
 * These routes handle CSV/large dataset exports efficiently
 */

// Export DTR as CSV (for a specific student)
router.get('/dtr/:studentId', authorize('student', 'coordinator', 'admin', 'supervisor'), exportDTRCSV);

// Export analytics report as CSV
router.get('/analytics', authorize('coordinator', 'admin'), exportAnalyticsCSV);

// Schedule a recurring report
router.post('/schedule', scheduleReportExport);

// Get all scheduled reports for current user
router.get('/scheduled', getScheduledReports);

// Delete a scheduled report
router.delete('/scheduled/:reportId', deleteScheduledReport);

// Stream paginated export data (for client-side processing)
router.post('/stream', streamExportData);

export default router;
