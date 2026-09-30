import { useCallback, useEffect, useState } from 'react';
import {
  getAttendancePolicy, getBackupStatus, getOperationalEvents, getPrivacySettings, getSystemHealth,
  runAttendanceImageCleanup, updateAttendancePolicy, updatePrivacySettings,
} from '../../api/system';
import EmptyState from './EmptyState';
import CollapsibleSection from './CollapsibleSection';
import { PageHeader } from './DashboardUI';
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

  const serviceDetail = (key, service) => {
    if (key === 'fileStorage') return `${service.storedFiles} files`;
    if (key === 'notifications' && (service.failed || service.dead)) return `${service.failed} retrying · ${service.dead} failed`;
    if (key === 'notifications') return `${service.pending} pending`;
    if (key === 'scheduledReports' && service.failed) return `${service.failed} failing`;
    if (key === 'operations') return `${service.errors24h} errors · ${service.slowRequests24h} slow (24h)`;
    return '';
  };

  return <div>
    <PageHeader
      title="System health"
      subtitle={health ? `${statusLabel(health.overall)} · ${health.responseTimeMs} ms · up ${Math.floor(health.uptimeSeconds / 3600)}h` : undefined}
      actions={<button className="btn-compact-primary system-health-refresh" onClick={load} disabled={loading}>{loading ? 'Checking…' : 'Refresh'}</button>}
    />
    {notice && <div className="status-message success-message" role="status">{notice}</div>}
    {error ? <div className="card"><EmptyState title="Health check unavailable" sub={error} action={load} actionLabel="Try again" /></div>
      : loading && !health ? <SkeletonPage variant="dashboard" label="Checking system health" />
        : health && <>
          <div className="card system-health-services">
            <ul className="coordinator-list">
              {Object.entries(health.services).map(([key, service]) => (
                <li className="coordinator-list-row" key={key}>
                  <div>
                    <strong>{labels[key] || key}</strong>
                    {serviceDetail(key, service) && <span className="coordinator-muted">{serviceDetail(key, service)}</span>}
                  </div>
                  <span className={`badge ${service.status === 'healthy' ? 'badge-success' : service.status === 'attention' ? 'badge-warning' : 'badge-gray'}`}>
                    {statusLabel(service.status)}
                  </span>
                </li>
              ))}
              <li className="coordinator-list-row">
                <div>
                  <strong>Backups</strong>
                  <span className="coordinator-muted">{backups?.latest ? new Date(backups.latest.verified_at).toLocaleDateString() : 'None verified'}</span>
                </div>
                <span className={`badge ${backups?.status === 'verified' ? 'badge-success' : 'badge-warning'}`} title={backups?.recommendation || undefined}>
                  {statusLabel(backups?.status)}
                </span>
              </li>
            </ul>
          </div>
          <CollapsibleSection title="Recent events" count={events.length}>
            {events.length === 0 ? <p className="coordinator-muted">No errors or slow requests.</p> : (
              <ul className="coordinator-list">
                {events.map(event => (
                  <li className="coordinator-list-row" key={event.id}>
                    <div>
                      <strong>{event.method} {event.path}</strong>
                      <span className="coordinator-muted">{event.status_code} · {event.duration_ms} ms · {new Date(event.created_at).toLocaleString()}</span>
                    </div>
                    <span className={`badge ${event.category === 'slow_request' ? 'badge-warning' : 'badge-danger'}`}>{event.category === 'slow_request' ? 'Slow' : 'Error'}</span>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>
          <CollapsibleSection title="Attendance policy">
            <div className="grid-2">
              <div className="form-group"><label>GPS accuracy limit (m)</label><input type="number" min="10" max="100" value={policy.maximumGpsAccuracyMeters} onChange={event => setPolicy({ ...policy, maximumGpsAccuracyMeters: Number(event.target.value) })} title="Worse fixes are flagged for review; above ±250 m they are rejected." /></div>
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
            }}>{attendanceSaving ? 'Saving…' : 'Save policy'}</button>
          </CollapsibleSection>
          <CollapsibleSection title="Image retention" aside={<span className="badge badge-gray">{retentionDays} days</span>}>
            <div className="form-group">
              <label htmlFor="retention-days">Delete attendance photos after deployment ends</label>
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
              }}>{privacySaving ? 'Saving…' : 'Save'}</button>
              <button className="action-btn action-btn-gray" disabled={privacySaving} onClick={async () => {
                setPrivacySaving(true); setError(''); setNotice('');
                try { await runAttendanceImageCleanup(); await load(); setNotice('Attendance image cleanup completed.'); }
                catch (requestError) { setError(requestError.response?.data?.message || 'Unable to run cleanup.'); }
                finally { setPrivacySaving(false); }
              }}>Run cleanup now</button>
            </div>
          </CollapsibleSection>
        </>}
  </div>;
};

export default SystemHealthPanel;
