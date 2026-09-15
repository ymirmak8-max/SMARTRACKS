import { useCallback, useEffect, useState } from 'react';
import {
  getAttendancePolicy, getBackupStatus, getOperationalEvents, getPrivacySettings, getSystemHealth,
  runAttendanceImageCleanup, updateAttendancePolicy, updatePrivacySettings,
} from '../../api/system';
import EmptyState from './EmptyState';
import { MetricCard, PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';

const labels = {
  database: 'Database',
  fileStorage: 'File storage',
  notifications: 'Notifications',
  email: 'Password-reset email',
  scheduledReports: 'Scheduled reports',
  operations: 'API monitoring',
};
const statusLabel = value => String(value || 'unknown').replace('_', ' ');

const SystemHealthPanel = () => {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retentionDays, setRetentionDays] = useState(90);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [events, setEvents] = useState([]);
  const [backups, setBackups] = useState(null);
  const [policy, setPolicy] = useState({
    selfieRequired: true, maximumGpsAccuracyMeters: 100, unpaidBreakMinutes: 60,
    maximumCreditedHours: 8, offlineSubmissionHours: 24,
  });
  const load = useCallback(async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const [healthResponse, privacyResponse, eventsResponse, policyResponse, backupResponse] = await Promise.all([
        getSystemHealth(), getPrivacySettings(), getOperationalEvents(), getAttendancePolicy(), getBackupStatus(),
      ]);
      setHealth(healthResponse.data);
      setRetentionDays(privacyResponse.data.settings.imageRetentionDays);
      setEvents(eventsResponse.data.events);
      setPolicy(policyResponse.data.policy);
      setBackups(backupResponse.data);
    }
    catch (requestError) { setError(requestError.response?.data?.message || 'Unable to check system health.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return <div>
    <PageHeader eyebrow="Administration" title="System health" subtitle="Configuration, delivery queues, storage, and background-job status." actions={
      <button className="btn-compact-primary system-health-refresh" onClick={load} disabled={loading}>{loading ? 'Checking…' : 'Refresh'}</button>
    } />
    {notice && <div className="status-message success-message" role="status">{notice}</div>}
    {error ? <div className="card"><EmptyState title="Health check unavailable" sub={error} action={load} actionLabel="Try again" /></div>
      : loading && !health ? <SkeletonPage variant="dashboard" label="Checking system health" />
        : health && <>
          <div className="stat-grid stat-grid-3" style={{ marginBottom: '0.875rem' }}>
            <MetricCard label="Overall" value={statusLabel(health.overall)} />
            <MetricCard label="API response" value={`${health.responseTimeMs} ms`} />
            <MetricCard label="Uptime" value={`${Math.floor(health.uptimeSeconds / 3600)}h`} />
          </div>
          <div className="card">
            <div className="card-title">Services</div>
            {Object.entries(health.services).map(([key, service]) => <div className="list-item" key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <strong>{labels[key] || key}</strong>
                <span className={`badge ${service.status === 'healthy' ? 'badge-success' : service.status === 'attention' ? 'badge-warning' : 'badge-gray'}`}>
                  {statusLabel(service.status)}
                </span>
              </div>
              {key === 'fileStorage' && <small>{service.backend} · {service.storedFiles} protected files</small>}
              {key === 'notifications' && <small>{service.pending} pending · {service.failed} retrying · {service.dead} exhausted</small>}
              {key === 'scheduledReports' && <small>{service.failed} active report failures</small>}
              {key === 'operations' && <small>{service.errors24h} errors · {service.slowRequests24h} slow requests in 24 hours</small>}
            </div>)}
          </div>
          <div className="card" style={{ marginTop: '0.875rem' }}>
            <div className="card-title">Backup and recovery readiness</div>
            <div className="list-item">
              <strong>Latest verification</strong>
              <span className={`badge ${backups?.status === 'verified' ? 'badge-success' : 'badge-warning'}`}>
                {statusLabel(backups?.status)}
              </span>
              <div className="small">
                {backups?.latest ? `${backups.latest.file_name} · ${new Date(backups.latest.verified_at).toLocaleString()}`
                  : 'No verified backup has been recorded.'}
              </div>
              {backups?.recommendation && <p style={{ color: 'var(--warning)' }}>{backups.recommendation}</p>}
            </div>
          </div>
          <div className="card" style={{ marginTop: '0.875rem' }}>
            <div className="card-title">Recent operational events</div>
            {events.length === 0 ? <p className="small">No API errors or slow requests recorded.</p> : events.map(event => (
              <div className="list-item" key={event.id}>
                <strong>{event.category === 'slow_request' ? 'Slow request' : 'API error'} · {event.method} {event.path}</strong>
                <div className="small">{event.status_code} · {event.duration_ms} ms · {new Date(event.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: '0.875rem' }}>
            <div className="card-title">Attendance policy</div>
            <div className="grid-2">
              <div className="form-group"><label>Preferred GPS accuracy (meters)</label><input type="number" min="10" max="100" value={policy.maximumGpsAccuracyMeters} onChange={event => setPolicy({ ...policy, maximumGpsAccuracyMeters: Number(event.target.value) })} /><small>Fixes worse than this are still recorded and flagged for review. Unusable fixes above ±250m are rejected.</small></div>
              <div className="form-group"><label>Unpaid break (minutes)</label><input type="number" min="0" max="180" value={policy.unpaidBreakMinutes} onChange={event => setPolicy({ ...policy, unpaidBreakMinutes: Number(event.target.value) })} /></div>
              <div className="form-group"><label>Maximum credited hours/day</label><input type="number" min="1" max="24" step="0.5" value={policy.maximumCreditedHours} onChange={event => setPolicy({ ...policy, maximumCreditedHours: Number(event.target.value) })} /></div>
              <div className="form-group"><label>Offline review threshold (hours)</label><input type="number" min="1" max="168" value={policy.offlineSubmissionHours} onChange={event => setPolicy({ ...policy, offlineSubmissionHours: Number(event.target.value) })} /></div>
            </div>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
              <input type="checkbox" checked={policy.selfieRequired} onChange={event => setPolicy({ ...policy, selfieRequired: event.target.checked })} />
              Require attendance selfies
            </label>
            <button className="action-btn action-btn-primary" disabled={attendanceSaving} onClick={async () => {
              setAttendanceSaving(true); setError(''); setNotice('');
              try { await updateAttendancePolicy(policy); setNotice('Attendance policy saved.'); }
              catch (requestError) { setError(requestError.response?.data?.message || 'Unable to save attendance policy.'); }
              finally { setAttendanceSaving(false); }
            }}>{attendanceSaving ? 'Saving…' : 'Save attendance policy'}</button>
          </div>
          <div className="card" style={{ marginTop: '0.875rem' }}>
            <div className="card-title">Attendance image privacy</div>
            <p style={{ color: 'var(--text-3)', fontSize: '0.84rem', marginBottom: '1rem' }}>
              Selfies are visible only to the student and the assigned coordinator or supervisor. Every full-image view and deletion is audited.
            </p>
            <div className="form-group">
              <label htmlFor="retention-days">Delete images after a deployment has ended for</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input id="retention-days" type="number" min="7" max="730" value={retentionDays}
                  onChange={event => setRetentionDays(Number(event.target.value))} style={{ maxWidth: '130px' }} />
                <span>days</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="action-btn action-btn-primary" disabled={privacySaving} onClick={async () => {
                setPrivacySaving(true); setError(''); setNotice('');
                try { await updatePrivacySettings({ imageRetentionDays: retentionDays }); setNotice('Retention policy saved.'); }
                catch (requestError) { setError(requestError.response?.data?.message || 'Unable to save privacy settings.'); }
                finally { setPrivacySaving(false); }
              }}>{privacySaving ? 'Saving…' : 'Save retention policy'}</button>
              <button className="action-btn action-btn-gray" disabled={privacySaving} onClick={async () => {
                setPrivacySaving(true); setError(''); setNotice('');
                try { await runAttendanceImageCleanup(); await load(); setNotice('Attendance image cleanup completed.'); }
                catch (requestError) { setError(requestError.response?.data?.message || 'Unable to run cleanup.'); }
                finally { setPrivacySaving(false); }
              }}>Run cleanup now</button>
            </div>
          </div>
        </>}
  </div>;
};

export default SystemHealthPanel;
