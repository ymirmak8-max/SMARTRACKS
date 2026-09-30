/**
 * Scheduled report job processor
 * Executes scheduled reports and handles delivery
 *
 * This should be run as a background job (e.g., via cron, node-schedule, or Bull queue)
 */

import pool from '../config/db.js';
import * as exportService from '../utils/exportService.js';
import { sendEmail } from '../utils/sendEmail.js';
import { logger } from '../utils/logger.js';

let processorTimer = null;

/**
 * Get due scheduled reports
 * @returns {Promise<array>} Array of reports due for execution
 */
export const getDueReports = async () => {
  const query = `
    SELECT *
    FROM scheduled_reports
    WHERE is_active = true
      AND next_run_at <= NOW()
    ORDER BY next_run_at ASC
  `;

  const result = await pool.query(query);
  return result.rows;
};

/**
 * Calculate next run time based on frequency
 * @param {string} frequency - 'once', 'weekly', 'monthly'
 * @param {Date} lastRun - When the report was last run
 * @returns {Date} Next scheduled run time
 */
export const calculateNextRun = (frequency, lastRun = new Date()) => {
  const nextRun = new Date(lastRun);

  switch (frequency) {
    case 'weekly':
      nextRun.setDate(nextRun.getDate() + 7);
      break;
    case 'monthly':
      nextRun.setMonth(nextRun.getMonth() + 1);
      break;
    case 'once':
      // Don't reschedule - will be disabled after execution
      return null;
    default:
      return null;
  }

  return nextRun;
};

/**
 * Generate report data based on type
 * @param {object} report - Scheduled report record
 * @returns {Promise<string>} CSV content
 */
export const generateReportData = async (report) => {
  const { report_type: reportType, report_params: params } = report;

  switch (reportType) {
    case 'dtr': {
      const startDate = params.startDate ? new Date(params.startDate) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = params.endDate ? new Date(params.endDate) : new Date();
      return exportService.exportStudentDTRAsCSV(params.studentId || report.user_id, startDate, endDate);
    }

    case 'analytics': {
      const startDate = params.startDate ? new Date(params.startDate) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = params.endDate ? new Date(params.endDate) : new Date();
      return exportService.exportAnalyticsReportAsCSV(params.coordinatorId || null, startDate, endDate);
    }

    case 'evaluation': {
      // Custom evaluation report logic
      const query = `
        SELECT e.period, e.total_score, e.comments, e.submitted_at,
               u.first_name AS student_first, u.last_name AS student_last
        FROM evaluations e
        JOIN deployments d ON d.id = e.deployment_id
        JOIN users u ON u.id = d.student_id
        WHERE e.supervisor_id = $1
        ORDER BY e.submitted_at DESC
      `;
      const result = await pool.query(query, [params.supervisorId || report.user_id]);

      const headers = ['Student', 'Evaluation Period', 'Score', 'Submitted Date', 'Comments'];
      const rows = result.rows.map(e => ({
        Student: `${e.student_first} ${e.student_last}`,
        'Evaluation Period': e.period,
        Score: `${e.total_score}/100`,
        'Submitted Date': new Date(e.submitted_at).toLocaleDateString(),
        Comments: e.comments || '',
      }));

      return exportService.generateCSV(rows, headers);
    }

    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
};

/**
 * Update report status after execution
 * @param {string} reportId - Report ID
 * @param {boolean} success - Whether execution was successful
 * @param {string} error - Error message if failed
 * @returns {Promise<object>} Updated report
 */
export const updateReportStatus = async (reportId, success = true, error = null) => {
  const frequency = await pool.query(
    'SELECT frequency FROM scheduled_reports WHERE id = $1',
    [reportId]
  );

  const report = frequency.rows[0];
  const nextRun = success
    ? calculateNextRun(report.frequency)
    : new Date(Date.now() + 15 * 60 * 1000);
  const active = !success || report.frequency !== 'once';
  const result = await pool.query(`
    UPDATE scheduled_reports
    SET last_run_at = NOW(), last_error = $2, next_run_at = COALESCE($3, next_run_at), is_active = $4
    WHERE id = $1
    RETURNING *
  `, [reportId, error, nextRun, active]);
  return result.rows[0];
};

/**
 * Execute a single scheduled report
 * @param {object} report - Scheduled report record
 * @returns {Promise<boolean>} Success status
 */
export const executeScheduledReport = async (report) => {
  try {
    logger.info('Executing scheduled report', { reportId: report.id, reportType: report.report_type });

    // Generate report data
    const csvContent = await generateReportData(report);

    // Create email attachment
    const filename = `report_${report.report_type}_${new Date().toISOString().split('T')[0]}.csv`;
    const attachment = Buffer.from(csvContent, 'utf-8');

    // Send email
    await sendEmail({
      to: report.delivery_email,
      subject: `Scheduled Report: ${report.report_type.toUpperCase()} - ${new Date().toLocaleDateString()}`,
      html: `
        <h2>Scheduled Report</h2>
        <p>Your requested ${report.report_type.toUpperCase()} report is attached.</p>
        <p>Report generated on: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
        <p>Best regards,<br/>Smartrack OJT Monitoring System</p>
      `,
      attachments: [
        {
          filename,
          content: attachment,
          contentType: 'text/csv'
        }
      ]
    });

    // Update status
    await updateReportStatus(report.id, true);

    logger.info('Scheduled report delivered', { reportId: report.id });
    return true;
  } catch (error) {
    logger.error('Scheduled report execution failed', { reportId: report.id, error });

    // Update status with error
    await updateReportStatus(report.id, false, error.message);

    return false;
  }
};

/**
 * Process all due scheduled reports
 * Call this function periodically (e.g., every 5 minutes via cron)
 * @returns {Promise<object>} Execution summary
 */
export const processScheduledReports = async () => {
  try {
    const reports = await getDueReports();

    if (reports.length === 0) {
      return { total: 0, successful: 0, failed: 0 };
    }

    let successful = 0;
    let failed = 0;

    for (const report of reports) {
      const success = await executeScheduledReport(report);
      if (success) successful++;
      else failed++;
    }

    const summary = {
      total: reports.length,
      successful,
      failed,
      timestamp: new Date().toISOString()
    };

    logger.info('Scheduled report batch complete', summary);
    return summary;
  } catch (error) {
    logger.error('Scheduled report batch failed', { error });
    throw error;
  }
};

/**
 * Start scheduled report processor as a background job
 *
 * Option 1: Using node-schedule (recommended)
 * @example
 * import schedule from 'node-schedule';
 * scheduleReportProcessor(schedule);
 */
export const scheduleReportProcessor = (scheduler) => {
  // Run every 5 minutes
  scheduler.scheduleJob('* /5 * * * *', async () => {
    try {
      await processScheduledReports();
    } catch (error) {
      logger.error('Scheduled report processor failed', { error });
    }
  });

  logger.info('Scheduled report processor started', { intervalMs: 300000 });
};

/**
 * Alternative: Start processor in interval (simple approach)
 * @param {number} intervalMs - Interval in milliseconds (default: 5 minutes)
 */
export const startReportProcessor = (intervalMs = 5 * 60 * 1000) => {
  if (processorTimer) return processorTimer;
  processorTimer = setInterval(async () => {
    try {
      await processScheduledReports();
    } catch (error) {
      logger.error('Report processor failed', { error });
    }
  }, intervalMs);

  logger.info('Report processor started', { intervalMs });
  return processorTimer;
};

export const stopReportProcessor = () => {
  if (processorTimer) clearInterval(processorTimer);
  processorTimer = null;
};

/**
 * Get processor status and statistics
 * @returns {Promise<object>} Status information
 */
export const getProcessorStatus = async () => {
  const dueQuery = `
    SELECT COUNT(*) as due_count
    FROM scheduled_reports
    WHERE is_active = true AND next_run_at <= NOW()
  `;

  const recentQuery = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN last_error IS NULL THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) as failed
    FROM scheduled_reports
    WHERE last_run_at >= NOW() - INTERVAL '24 hours'
  `;

  const due = await pool.query(dueQuery);
  const recent = await pool.query(recentQuery);

  return {
    due_reports: parseInt(due.rows[0].due_count),
    last_24h: {
      total: parseInt(recent.rows[0].total) || 0,
      successful: parseInt(recent.rows[0].successful) || 0,
      failed: parseInt(recent.rows[0].failed) || 0
    },
    timestamp: new Date().toISOString()
  };
};

export default {
  getDueReports,
  calculateNextRun,
  generateReportData,
  updateReportStatus,
  executeScheduledReport,
  processScheduledReports,
  scheduleReportProcessor,
  startReportProcessor,
  stopReportProcessor,
  getProcessorStatus
};
