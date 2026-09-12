import api from './axios';

/**
 * Server-side export APIs for handling large dataset exports
 */

/**
 * Export student DTR as CSV (server-side)
 * @param {string} studentId - Student ID
 * @param {object} options - Export options
 * @param {string} options.startDate - Start date (YYYY-MM-DD)
 * @param {string} options.endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Blob>} CSV file blob
 */
export const exportDTRAsCSV = async (studentId, { startDate, endDate } = {}) => {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);

  const response = await api.get(`/exports/dtr/${studentId}?${params}`, {
    responseType: 'blob',
  });

  return response.data;
};

/**
 * Export analytics report as CSV (server-side)
 * @param {object} options - Export options
 * @param {string} options.startDate - Start date (YYYY-MM-DD)
 * @param {string} options.endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Blob>} CSV file blob
 */
export const exportAnalyticsAsCSV = async ({ startDate, endDate } = {}) => {
  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);

  const response = await api.get(`/exports/analytics?${params}`, {
    responseType: 'blob',
  });

  return response.data;
};

/**
 * Stream paginated export data for client-side processing
 * Useful for building custom exports or client-side aggregation
 * @param {object} options - Streaming options
 * @param {string} options.reportType - Type of report ('dtr', 'analytics', etc.)
 * @param {object} options.queryParams - Query parameters for the report
 * @param {number} options.batchSize - Number of records per batch (default: 1000)
 * @param {number} options.offset - Starting offset (default: 0)
 * @returns {Promise<object>} { data: array, total: number, hasMore: boolean, offset: number }
 */
export const streamExportData = async ({
  reportType,
  queryParams = {},
  batchSize = 1000,
  offset = 0,
} = {}) => {
  const response = await api.post('/exports/stream', {
    reportType,
    queryParams,
    batchSize,
    offset,
  });

  return response.data;
};

/**
 * Stream all data for a report with automatic pagination
 * @param {object} options - Streaming options
 * @returns {Promise<array>} All records combined
 */
export const streamAllExportData = async (options) => {
  let allData = [];
  let hasMore = true;
  let offset = 0;

  while (hasMore) {
    const result = await streamExportData({
      ...options,
      offset,
    });

    allData = allData.concat(result.data);
    offset = result.offset;
    hasMore = result.hasMore;
  }

  return allData;
};

/**
 * Schedule a recurring report
 * @param {object} options - Report scheduling options
 * @param {string} options.reportType - Type of report ('dtr', 'analytics', 'evaluation')
 * @param {string} options.frequency - Frequency ('once', 'weekly', 'monthly')
 * @param {string} options.deliveryEmail - Email to deliver report to
 * @param {object} options.reportParams - Report-specific parameters
 * @param {string} options.nextRunAt - ISO date string for next run (optional)
 * @returns {Promise<object>} Scheduled report details
 */
export const scheduleReport = async ({
  reportType,
  frequency,
  deliveryEmail,
  reportParams = {},
  nextRunAt,
} = {}) => {
  const response = await api.post('/exports/schedule', {
    reportType,
    frequency,
    deliveryEmail,
    reportParams,
    nextRunAt,
  });

  return response.data;
};

/**
 * Get all scheduled reports for current user
 * @returns {Promise<array>} Array of scheduled reports
 */
export const getScheduledReports = async () => {
  const response = await api.get('/exports/scheduled');
  return response.data.data;
};

/**
 * Delete a scheduled report
 * @param {string} reportId - Report ID to delete
 * @returns {Promise<object>} Success message
 */
export const deleteScheduledReport = async (reportId) => {
  const response = await api.delete(`/exports/scheduled/${reportId}`);
  return response.data;
};

/**
 * Download CSV blob as file
 * @param {Blob} csvBlob - CSV data blob
 * @param {string} filename - File name (without extension)
 */
export const downloadCSV = (csvBlob, filename = 'export') => {
  const url = window.URL.createObjectURL(csvBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Convert CSV data to JSON
 * @param {Blob} csvBlob - CSV data blob
 * @returns {Promise<array>} Array of objects
 */
export const csvToJSON = async (csvBlob) => {
  const text = await csvBlob.text();
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');

  const result = lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, index) => {
      obj[header.trim()] = values[index]?.trim() || '';
    });
    return obj;
  });

  return result;
};

export default {
  exportDTRAsCSV,
  exportAnalyticsAsCSV,
  streamExportData,
  streamAllExportData,
  scheduleReport,
  getScheduledReports,
  deleteScheduledReport,
  downloadCSV,
  csvToJSON,
};
