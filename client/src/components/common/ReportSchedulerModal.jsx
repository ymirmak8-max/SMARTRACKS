/**
 * ReportScheduler Modal Component
 * Dialog for scheduling recurring reports
 * Used across all dashboards for different report types
 */

import { useState, useCallback } from 'react';
import VectorIcon from './VectorIcon';
import { announceMessage } from '../../utils/accessibility';

export const ReportSchedulerModal = ({
  isOpen = false,
  onClose = null,
  onSchedule = null,
  loading = false,
  reportType = 'analytics', // 'dtr', 'analytics', 'evaluation'
  reportTypeLabel = 'Analytics Report',
  additionalFields = null, // Custom fields for specific reports
  ariaLabel = 'Schedule Report',
}) => {
  const [frequency, setFrequency] = useState('weekly');
  const [deliveryEmail, setDeliveryEmail] = useState('');
  const [nextRunDate, setNextRunDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [customParams, setCustomParams] = useState({});
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = useCallback(
    async e => {
      e.preventDefault();
      setError('');
      setSuccessMessage('');

      // Validation
      if (!deliveryEmail || !deliveryEmail.includes('@')) {
        setError('Please enter a valid email address');
        announceMessage('Invalid email address', 'alert');
        return;
      }

      if (!nextRunDate) {
        setError('Please select a run date');
        announceMessage('Please select a run date', 'alert');
        return;
      }

      try {
        await onSchedule({
          reportType,
          frequency,
          deliveryEmail,
          nextRunAt: new Date(nextRunDate),
          reportParams: customParams,
        });

        setSuccessMessage(
          `${reportTypeLabel} scheduled for ${frequency} delivery`
        );
        announceMessage(
          `Report scheduled successfully for ${frequency} delivery to ${deliveryEmail}`,
          'polite'
        );

        setTimeout(() => {
          onClose?.();
          setDeliveryEmail('');
          setFrequency('weekly');
          setNextRunDate(new Date().toISOString().split('T')[0]);
          setCustomParams({});
          setSuccessMessage('');
        }, 2000);
      } catch (err) {
        const message = err.message || 'Failed to schedule report';
        setError(message);
        announceMessage(message, 'alert');
      }
    },
    [
      frequency,
      deliveryEmail,
      nextRunDate,
      customParams,
      onSchedule,
      reportType,
      reportTypeLabel,
      onClose,
    ]
  );

  const handleClose = useCallback(() => {
    setError('');
    setSuccessMessage('');
    onClose?.();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={handleClose}
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
          if (e.key === 'Escape') handleClose();
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
          <h2 id="schedule-report-title" style={{ margin: 0, fontSize: '1.1rem' }}>
            Schedule {reportTypeLabel}
          </h2>
          <button
            onClick={handleClose}
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

        {/* Messages */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
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

        {successMessage && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: '12px',
              background: '#dcfce7',
              border: '1px solid #bbf7d0',
              borderRadius: '4px',
              color: '#16a34a',
              marginBottom: '16px',
              fontSize: '14px',
            }}
          >
            {successMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Frequency */}
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: '8px' }}>
              Frequency
            </legend>
            <div style={{ display: 'flex', gap: '12px' }}>
              {['once', 'weekly', 'monthly'].map(freq => (
                <label
                  key={freq}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="frequency"
                    value={freq}
                    checked={frequency === freq}
                    onChange={e => setFrequency(e.target.value)}
                    aria-label={`Schedule ${freq}`}
                  />
                  <span style={{ textTransform: 'capitalize' }}>
                    {freq}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Email */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label
              htmlFor="delivery-email"
              style={{ fontWeight: 600 }}
            >
              Delivery Email
            </label>
            <input
              id="delivery-email"
              type="email"
              value={deliveryEmail}
              onChange={e => setDeliveryEmail(e.target.value)}
              placeholder="Where should we send the report, e.g. you@school.edu"
              required
              aria-required="true"
              aria-describedby="email-help"
              style={{
                padding: '10px',
                border: '1px solid #e5e7eb',
                borderRadius: '4px',
                fontSize: '14px',
                fontFamily: 'inherit',
              }}
            />
            <small
              id="email-help"
              style={{ color: 'rgba(0, 0, 0, 0.6)', fontSize: '12px' }}
            >
              Reports will be sent to this email address
            </small>
          </div>

          {/* Next Run Date */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label
              htmlFor="next-run-date"
              style={{ fontWeight: 600 }}
            >
              First Report Date
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <VectorIcon name="calendar" size={18} />
              <input
                id="next-run-date"
                type="date"
                value={nextRunDate}
                onChange={e => setNextRunDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
                aria-required="true"
                style={{
                  flex: 1,
                  padding: '10px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '4px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          {/* Additional Fields */}
          {additionalFields && (
            <div style={{ paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
              {additionalFields}
            </div>
          )}

          {/* Actions */}
          <div
            className="modal-actions"
            style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end',
              paddingTop: '12px',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="btn btn-outline"
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              aria-busy={loading}
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Scheduling...' : 'Schedule Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReportSchedulerModal;
