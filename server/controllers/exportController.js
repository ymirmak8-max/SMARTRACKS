import * as exportService from '../utils/exportService.js';
import pool from '../config/db.js';

const parseDate = (value, fallback) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const canAccessStudent = async (user, studentId) => {
  if (user.role === 'coordinator') return true;
  if (user.role === 'student') return user.id === studentId;
  const column = user.role === 'coordinator' ? 'coordinator_id' : 'supervisor_id';
  const result = await pool.query(
    `SELECT 1 FROM deployments WHERE student_id = $1 AND ${column} = $2 AND status = 'active'`,
    [studentId, user.id]
  );
  return result.rows.length > 0;
};

/**
 * Export student DTR as CSV (server-side)
 * GET /api/exports/dtr/:studentId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const exportDTRCSV = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate } = req.query;

    // Validate required fields
    if (!studentId) {
      return res.status(400).json({ message: 'Student ID is required' });
    }

    if (!await canAccessStudent(req.user, studentId))
      return res.status(404).json({ message: 'Student record not found' });
    const start = parseDate(startDate, new Date(new Date().getFullYear(), 0, 1));
    const end = parseDate(endDate, new Date());
    if (!start || !end || start > end)
      return res.status(400).json({ message: 'A valid date range is required' });

    const csv = await exportService.exportStudentDTRAsCSV(studentId, start, end);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="DTR_${studentId}_${new Date().getTime()}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('DTR export error:', error);
    res.status(500).json({ message: 'Failed to export DTR' });
  }
};

/**
 * Export analytics report as CSV (server-side)
 * GET /api/exports/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export const exportAnalyticsCSV = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { id: userId, role } = req.user;

    // Get coordinator ID if user is coordinator
    const coordinatorId = null;

    const start = parseDate(startDate, new Date(new Date().getFullYear(), 0, 1));
    const end = parseDate(endDate, new Date());
    if (!start || !end || start > end)
      return res.status(400).json({ message: 'A valid date range is required' });

    const csv = await exportService.exportAnalyticsReportAsCSV(coordinatorId, start, end);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="Analytics_Report_${new Date().getTime()}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Analytics export error:', error);
    res.status(500).json({ message: 'Failed to export analytics' });
  }
};

/**
 * Schedule a report for recurring generation
 * POST /api/exports/schedule
 * Body: { reportType, frequency, deliveryEmail, reportParams, nextRunAt }
 */
export const scheduleReportExport = async (req, res) => {
  try {
    const { reportType, frequency, deliveryEmail, reportParams, nextRunAt } = req.body;
    const { id: userId } = req.user;

    // Validate required fields
    if (!reportType || !frequency || !deliveryEmail) {
      return res.status(400).json({
        message: 'reportType, frequency, and deliveryEmail are required',
      });
    }

    const validReportTypes = ['dtr', 'analytics', 'evaluation'];
    const validFrequencies = ['once', 'weekly', 'monthly'];

    if (!validReportTypes.includes(reportType)) {
      return res.status(400).json({ message: `Invalid report type. Must be one of: ${validReportTypes.join(', ')}` });
    }

    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({ message: `Invalid frequency. Must be one of: ${validFrequencies.join(', ')}` });
    }

    const allowedType = { student: 'dtr', supervisor: 'evaluation', coordinator: 'analytics' }[req.user.role];
    if (reportType !== allowedType)
      return res.status(403).json({ message: 'This report type is not available for your role' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deliveryEmail))
      return res.status(400).json({ message: 'A valid delivery email is required' });
    const runAt = parseDate(nextRunAt, new Date());
    if (!runAt) return res.status(400).json({ message: 'A valid run date is required' });
    const safeParams = reportType === 'dtr'
      ? { ...reportParams, studentId: userId }
      : reportType === 'evaluation'
        ? { ...reportParams, supervisorId: userId }
        : { ...reportParams, coordinatorId: null };

    const scheduled = await exportService.scheduleReport({
      userId,
      reportType,
      frequency,
      deliveryEmail,
      reportParams: safeParams,
      nextRunAt: runAt,
    });

    res.status(201).json({
      message: 'Report scheduled successfully',
      data: scheduled,
    });
  } catch (error) {
    console.error('Schedule report error:', error);
    res.status(500).json({ message: 'Failed to schedule report' });
  }
};

/**
 * Get all scheduled reports for current user
 * GET /api/exports/scheduled
 */
export const getScheduledReports = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const reports = await exportService.getScheduledReports(userId);

    res.json({
      data: reports,
    });
  } catch (error) {
    console.error('Get scheduled reports error:', error);
    res.status(500).json({ message: 'Failed to retrieve scheduled reports' });
  }
};

/**
 * Delete a scheduled report
 * DELETE /api/exports/scheduled/:reportId
 */
export const deleteScheduledReport = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { id: userId } = req.user;

    const success = await exportService.deleteScheduledReport(reportId, userId);

    if (!success) {
      return res.status(404).json({ message: 'Scheduled report not found' });
    }

    res.json({ message: 'Scheduled report deleted successfully' });
  } catch (error) {
    console.error('Delete scheduled report error:', error);
    res.status(500).json({ message: 'Failed to delete scheduled report' });
  }
};

/**
 * Stream paginated data for client-side processing
 * POST /api/exports/stream
 * Body: { reportType, queryParams, batchSize, offset }
 */
export const streamExportData = async (req, res) => {
  try {
    const { reportType, queryParams = {}, batchSize = 1000, offset = 0 } = req.body;
    const { id: userId, role } = req.user;

    let query;
    let params = [];

    if (reportType === 'analytics') {
      const coordinatorId = null;
      if (role !== 'coordinator')
        return res.status(403).json({ message: 'Analytics export is not available for your role' });
      query = `
        SELECT
          u.id, u.first_name, u.last_name, u.email, u.course,
          c.name AS company_name,
          COALESCE(SUM(tr.total_hours), 0) AS total_hours_rendered
        FROM users u
        LEFT JOIN deployments d ON u.id = d.student_id
        LEFT JOIN companies c ON c.id = d.company_id
        LEFT JOIN time_records tr ON u.id = tr.student_id AND tr.is_valid = true
        WHERE u.role = 'student' AND ($1::UUID IS NULL OR d.coordinator_id = $1)
        GROUP BY u.id, u.first_name, u.last_name, u.email, u.course, c.name
        ORDER BY u.first_name, u.last_name
      `;
      params = [coordinatorId];
    } else if (reportType === 'dtr') {
      const { studentId } = queryParams;
      if (!studentId || !await canAccessStudent(req.user, studentId))
        return res.status(404).json({ message: 'Student record not found' });
      query = `
        SELECT * FROM time_records
        WHERE student_id = $1
        ORDER BY date DESC
      `;
      params = [studentId];
    }

    if (!query) {
      return res.status(400).json({ message: 'Invalid report type' });
    }

    const result = await exportService.streamDataForExport({
      query,
      params,
      offset,
      limit: Math.min(batchSize, 5000), // Cap at 5000
    });

    res.json(result);
  } catch (error) {
    console.error('Stream export error:', error);
    res.status(500).json({ message: 'Failed to stream export data' });
  }
};

export default {
  exportDTRCSV,
  exportAnalyticsCSV,
  scheduleReportExport,
  getScheduledReports,
  deleteScheduledReport,
  streamExportData,
};
