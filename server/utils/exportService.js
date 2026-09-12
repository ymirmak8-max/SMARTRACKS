import pool from '../config/db.js';

/**
 * Export service for handling large dataset exports with streaming
 * Supports CSV and JSON formats with pagination for memory efficiency
 */

const BATCH_SIZE = 1000; // Process records in batches

/**
 * Stream CSV export for large datasets
 * @param {object} options - Export options
 * @param {string} options.query - SQL query to execute
 * @param {array} options.params - Query parameters
 * @param {array} options.headers - CSV header names
 * @param {function} options.formatter - Function to format row data (optional)
 * @param {number} options.offset - Pagination offset
 * @param {number} options.limit - Batch size limit
 * @returns {Promise<{data: array, total: number, hasMore: boolean}>}
 */
export const streamDataForExport = async ({
  query,
  params = [],
  formatter = null,
  offset = 0,
  limit = BATCH_SIZE,
}) => {
  try {
    // Get paginated data
    const paginatedQuery = `${query} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const dataParams = [...params, limit, offset];
    const result = await pool.query(paginatedQuery, dataParams);

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM (${query}) as counted`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Format data if formatter provided
    const data = formatter ? result.rows.map(formatter) : result.rows;

    return {
      data,
      total,
      hasMore: offset + limit < total,
      offset: offset + limit,
    };
  } catch (error) {
    throw new Error(`Export streaming failed: ${error.message}`);
  }
};

/**
 * Generate CSV content from array of objects
 * @param {array} records - Array of data objects
 * @param {array} headers - Header keys to extract
 * @returns {string} CSV formatted string
 */
export const generateCSV = (records, headers) => {
  if (!records || records.length === 0) {
    return headers.join(',') + '\n';
  }

  // Escape CSV values
  const escapeCSV = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Create header row
  const headerRow = headers.join(',');

  // Create data rows
  const dataRows = records.map((record) =>
    headers.map((header) => escapeCSV(record[header])).join(',')
  );

  return [headerRow, ...dataRows].join('\n');
};

/**
 * Export student DTR records as CSV
 * @param {string} studentId - Student ID
 * @param {date} startDate - Start date
 * @param {date} endDate - End date
 * @returns {Promise<string>} CSV data
 */
export const exportStudentDTRAsCSV = async (studentId, startDate, endDate) => {
  const query = `
    SELECT
      d.date,
      d.clock_in,
      d.clock_out,
      d.total_hours,
      d.anomaly_flag,
      d.evidence_note,
      d.created_at
    FROM time_records d
    WHERE d.student_id = $1
      AND d.date >= $2
      AND d.date <= $3
    ORDER BY d.date DESC
  `;

  const result = await pool.query(query, [studentId, startDate, endDate]);
  const headers = ['Date', 'Time In', 'Time Out', 'Total Hours', 'Anomaly Flag', 'Evidence Note', 'Created At'];

  const formatter = (row) => ({
    Date: row.date ? new Date(row.date).toLocaleDateString() : '',
    'Time In': row.clock_in ? new Date(row.clock_in).toLocaleTimeString() : '',
    'Time Out': row.clock_out ? new Date(row.clock_out).toLocaleTimeString() : '',
    'Total Hours': row.total_hours || '',
    'Anomaly Flag': row.anomaly_flag ? 'Yes' : 'No',
    'Evidence Note': row.evidence_note || '',
    'Created At': row.created_at ? new Date(row.created_at).toLocaleString() : '',
  });

  const formattedRecords = result.rows.map(formatter);
  return generateCSV(formattedRecords, headers);
};

/**
 * Export analytics report as CSV
 * @param {string} coordinatorId - Coordinator ID (optional, for filtering)
 * @param {date} startDate - Start date
 * @param {date} endDate - End date
 * @returns {Promise<string>} CSV data
 */
export const exportAnalyticsReportAsCSV = async (coordinatorId, startDate, endDate) => {
  const query = `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.email,
      u.course,
      c.name AS company_name,
      COUNT(DISTINCT tr.id) AS total_days_recorded,
      COALESCE(SUM(tr.total_hours), 0) AS total_hours_rendered,
      COUNT(DISTINCT tr.date) AS unique_days,
      COUNT(*) FILTER (WHERE tr.anomaly_flag IS NOT NULL AND tr.anomaly_flag <> '') AS flagged_records
    FROM users u
    LEFT JOIN deployments d ON u.id = d.student_id
    LEFT JOIN companies c ON c.id = d.company_id
    LEFT JOIN time_records tr ON u.id = tr.student_id AND tr.is_valid = true
      AND tr.date >= $2
      AND tr.date <= $3
    WHERE u.role = 'student'
      AND ($1::UUID IS NULL OR d.coordinator_id = $1)
    GROUP BY u.id, u.first_name, u.last_name, u.email, u.course, c.name
    ORDER BY u.first_name, u.last_name
  `;

  const result = await pool.query(query, [coordinatorId || null, startDate, endDate]);

  const headers = [
    'Student ID',
    'First Name',
    'Last Name',
    'Email',
    'Course',
    'Company',
    'Total Days Recorded',
    'Total Hours Rendered',
    'Unique Days',
    'Flagged Records',
  ];

  const formatter = (row) => ({
    'Student ID': row.id,
    'First Name': row.first_name,
    'Last Name': row.last_name,
    'Email': row.email,
    'Course': row.course,
    'Company': row.company_name,
    'Total Days Recorded': row.total_days_recorded,
    'Total Hours Rendered': row.total_hours_rendered,
    'Unique Days': row.unique_days,
    'Flagged Records': row.flagged_records,
  });

  const formattedRecords = result.rows.map(formatter);
  return generateCSV(formattedRecords, headers);
};

/**
 * Schedule a report for later generation and delivery
 * @param {object} options - Report scheduling options
 * @returns {Promise<object>} Scheduled report details
 */
export const scheduleReport = async ({
  userId,
  reportType, // 'dtr', 'analytics', 'evaluation'
  frequency, // 'once', 'weekly', 'monthly'
  deliveryEmail,
  reportParams = {},
  nextRunAt = new Date(),
}) => {
  const query = `
    INSERT INTO scheduled_reports (
      user_id,
      report_type,
      frequency,
      delivery_email,
      report_params,
      next_run_at,
      is_active,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
    RETURNING *
  `;

  const result = await pool.query(query, [
    userId,
    reportType,
    frequency,
    deliveryEmail,
    JSON.stringify(reportParams),
    nextRunAt,
  ]);

  return result.rows[0];
};

/**
 * Get scheduled reports for a user
 * @param {string} userId - User ID
 * @returns {Promise<array>} Array of scheduled reports
 */
export const getScheduledReports = async (userId) => {
  const query = `
    SELECT *
    FROM scheduled_reports
    WHERE user_id = $1
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query, [userId]);
  return result.rows;
};

/**
 * Delete a scheduled report
 * @param {string} reportId - Report ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<boolean>} Success status
 */
export const deleteScheduledReport = async (reportId, userId) => {
  const query = `
    DELETE FROM scheduled_reports
    WHERE id = $1 AND user_id = $2
    RETURNING id
  `;

  const result = await pool.query(query, [reportId, userId]);
  return result.rowCount > 0;
};

export default {
  streamDataForExport,
  generateCSV,
  exportStudentDTRAsCSV,
  exportAnalyticsReportAsCSV,
  scheduleReport,
  getScheduledReports,
  deleteScheduledReport,
};
