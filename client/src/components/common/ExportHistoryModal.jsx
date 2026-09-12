/**
 * Export History Component
 * Shows past exports and scheduled reports
 * Allows management of scheduled reports
 */

import { useState, useEffect } from 'react';
import VectorIcon from './VectorIcon';
import SkeletonPage from './Skeleton';
import { getScheduledReports, deleteScheduledReport } from '../../api/exports';

export const ExportHistoryModal = ({
  isOpen = false,
  onClose = null,
  loading: initialLoading = false,
  ariaLabel = 'Export History',
}) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchReports();
    }
  }, [isOpen]);

  const fetchReports = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getScheduledReports();
      setReports(data);
    } catch (err) {
      setError(err.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async reportId => {
    if (!window.confirm('Are you sure you want to delete this scheduled report?'))
      return;

    setDeleting(reportId);
    try {
      await deleteScheduledReport(reportId);
      setReports(reports.filter(r => r.id !== reportId));
    } catch (err) {
      setError(err.message || 'Failed to delete report');
    } finally {
      setDeleting(null);
    }
  };

  if (!isOpen) return null;

  const formatDate = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFrequency = (freq) => {
    return freq.charAt(0).toUpperCase() + freq.slice(1);
  };

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        className="export-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose?.();
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <h2 id="export-history-title" style={{ margin: 0, fontSize: '1.1rem' }}>
            Scheduled Reports
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            type="button"
            style={{
              background: 'rgba(15, 23, 42, 0.06)',
              border: 'none',
              borderRadius: '999px',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <VectorIcon name="x" size={20} />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            style={{
              padding: '12px',
              background: '#fee2e2',
              border: '1px solid #fecaca',
              borderRadius: '4px',
              color: '#dc2626',
              marginBottom: '16px',
              fontSize: '14px',
            }}
          >
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <SkeletonPage variant="list" label="Loading reports" />
        ) : reports.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: 'var(--text-3)',
            }}
            role="status"
          >
            <VectorIcon name="clock" size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <p>No scheduled reports yet</p>
            <p style={{ fontSize: '14px' }}>
              Create your first scheduled report to see it here
            </p>
          </div>
        ) : (
          /* Reports Table */
          <div
            className="table-container"
            role="region"
            aria-label="Scheduled reports"
            style={{ overflowX: 'auto' }}
          >
            <table
              className="export-history-table"
              role="table"
            >
              <thead role="rowgroup">
                <tr role="row">
                  <th
                    scope="col"
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      borderBottom: '2px solid #e5e7eb',
                      background: 'var(--surface-2)',
                    }}
                  >
                    Report Type
                  </th>
                  <th
                    scope="col"
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      borderBottom: '2px solid #e5e7eb',
                      background: 'var(--surface-2)',
                    }}
                  >
                    Frequency
                  </th>
                  <th
                    scope="col"
                    style={{
                      padding: '12px',
                      textAlign: 'left',
                      fontWeight: 600,
                      borderBottom: '2px solid #e5e7eb',
                      background: 'var(--surface-2)',
                    }}
                  >
                    Next Run
                  </th>
                  <th
                    scope="col"
                    style={{
                      padding: '12px',
                      textAlign: 'center',
                      fontWeight: 600,
                      borderBottom: '2px solid #e5e7eb',
                      background: 'var(--surface-2)',
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {reports.map(report => (
                  <tr
                    key={report.id}
                    role="row"
                    style={{
                      borderBottom: '1px solid #e5e7eb',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={e =>
                      (e.currentTarget.style.background = 'var(--surface-2)')
                    }
                    onMouseLeave={e =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <td
                      role="cell"
                      style={{
                        padding: '12px',
                        fontWeight: 600,
                      }}
                    >
                      <span className="history-pill">{report.report_type}</span>
                    </td>
                    <td
                      role="cell"
                      style={{
                        padding: '12px',
                      }}
                    >
                      <span className="history-pill">{formatFrequency(report.frequency)}</span>
                    </td>
                    <td
                      role="cell"
                      style={{ padding: '12px', fontSize: '13px' }}
                    >
                      {formatDate(report.next_run_at)}
                    </td>
                    <td
                      role="cell"
                      style={{
                        padding: '12px',
                        textAlign: 'center',
                      }}
                    >
                      <button
                        onClick={() => handleDelete(report.id)}
                        disabled={deleting === report.id}
                        aria-label={`Delete ${report.report_type} scheduled report`}
                        title="Delete report"
                        className="delete-action-btn"
                        style={{ opacity: deleting === report.id ? 0.6 : 1 }}
                      >
                        <VectorIcon name="trash" size={16} />
                        {deleting === report.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            paddingTop: '16px',
            borderTop: '1px solid #e5e7eb',
            marginTop: '20px',
          }}
        >
          <button
            onClick={onClose}
            className="btn btn-outline"
            aria-label="Close dialog"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportHistoryModal;
