import { useCallback, useEffect, useState } from 'react';
import {
  createCalendarException, getAttendanceRequests, getCalendarExceptions,
  getMyAttendanceExceptions, reviewAttendanceRequest, submitAttendanceRequest,
} from '../../api/attendanceExceptions';
import { getCompanies } from '../../api/deployments';
import EmptyState from './EmptyState';
import { PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';

const STATUS_STYLE = {
  pending: { background: 'var(--warning-light)', color: 'var(--warning)' },
  approved: { background: 'var(--success-light)', color: 'var(--success)' },
  rejected: { background: 'var(--danger-light)', color: 'var(--danger)' },
};

const formatDate = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString() : '';

const AttendanceExceptionsPage = ({ reviewer = false }) => {
  const [items, setItems] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const emptyRequest = { type: 'leave', dateFrom: '', dateTo: '', reason: '', evidenceUrl: '', proposedClockIn: '', proposedClockOut: '' };
  const [requestForm, setRequestForm] = useState(emptyRequest);
  const [calendarForm, setCalendarForm] = useState({ type: 'holiday', companyId: '', dateFrom: '', dateTo: '', reason: '' });

  const showToast = useCallback(message => { setToast(message); setTimeout(() => setToast(''), 6000); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (reviewer) {
        const [requests, dates, companyList] = await Promise.all([
          getAttendanceRequests(), getCalendarExceptions(), getCompanies(),
        ]);
        setItems(requests.data.requests);
        setCalendar(dates.data.exceptions);
        setCompanies(companyList.data.companies);
      } else {
        const response = await getMyAttendanceExceptions();
        setItems(response.data.exceptions);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to load attendance exceptions.');
    } finally { setLoading(false); }
  }, [reviewer]);

  useEffect(() => { load(); }, [load]);

  const submitRequest = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await submitAttendanceRequest({ ...requestForm, dateTo: requestForm.dateTo || requestForm.dateFrom });
      setRequestForm(emptyRequest);
      showToast('Request submitted for review.'); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Failed to submit request.'); }
    finally { setSaving(false); }
  };

  const review = async (id, decision) => {
    const remarks = window.prompt(`${decision === 'approved' ? 'Approval' : 'Rejection'} remarks (optional):`) ?? null;
    if (remarks === null) return;
    try { await reviewAttendanceRequest(id, { decision, remarks }); showToast(`Request ${decision}.`); await load(); }
    catch (requestError) { setError(requestError.response?.data?.message || 'Review failed.'); }
  };

  const addCalendarDate = async event => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await createCalendarException({ ...calendarForm, dateTo: calendarForm.dateTo || calendarForm.dateFrom });
      setCalendarForm({ type: 'holiday', companyId: '', dateFrom: '', dateTo: '', reason: '' });
      showToast('Non-working date added.'); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Failed to add date.'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Attendance"
        title={reviewer ? 'Attendance exceptions' : 'Leave & corrections'}
        subtitle={reviewer ? 'Review requests and manage non-working dates.' : 'Request approved leave or correction for a missed attendance record.'}
      />

      <div className="card" style={{ marginBottom: '0.875rem' }}>
        <div className="card-title">{reviewer ? 'Add holiday or closure' : 'New request'}</div>
        <form onSubmit={reviewer ? addCalendarDate : submitRequest}>
          <div className="grid-2">
            <div className="form-group">
              <label>Type</label>
              <select value={reviewer ? calendarForm.type : requestForm.type} onChange={event => reviewer
                ? setCalendarForm({ ...calendarForm, type: event.target.value })
                : setRequestForm({ ...requestForm, type: event.target.value })}>
                {reviewer ? <><option value="holiday">Holiday</option><option value="closure">Company closure</option></>
                  : <><option value="leave">Leave</option><option value="correction">Attendance correction</option></>}
              </select>
            </div>
            {reviewer && (
              <div className="form-group">
                <label>Company</label>
                <select value={calendarForm.companyId} onChange={event => setCalendarForm({ ...calendarForm, companyId: event.target.value })}>
                  <option value="">All companies</option>
                  {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </div>
            )}
          </div>
          {!reviewer && requestForm.type === 'correction' && (
            <div className="grid-2">
              <div className="form-group"><label>Correct Time In</label><input type="time" value={requestForm.proposedClockIn} onChange={event => setRequestForm({ ...requestForm, proposedClockIn: event.target.value })} /></div>
              <div className="form-group"><label>Correct Time Out</label><input type="time" value={requestForm.proposedClockOut} onChange={event => setRequestForm({ ...requestForm, proposedClockOut: event.target.value })} /></div>
            </div>
          )}
          <div className="grid-2">
            <div className="form-group"><label>From *</label><input type="date" required value={reviewer ? calendarForm.dateFrom : requestForm.dateFrom} onChange={event => reviewer ? setCalendarForm({ ...calendarForm, dateFrom: event.target.value }) : setRequestForm({ ...requestForm, dateFrom: event.target.value })} /></div>
            <div className="form-group"><label>To</label><input type="date" value={reviewer ? calendarForm.dateTo : requestForm.dateTo} onChange={event => reviewer ? setCalendarForm({ ...calendarForm, dateTo: event.target.value }) : setRequestForm({ ...requestForm, dateTo: event.target.value })} /></div>
          </div>
          <div className="form-group"><label>{reviewer ? 'Description' : 'Reason'} *</label><textarea required rows={3} value={reviewer ? calendarForm.reason : requestForm.reason} onChange={event => reviewer ? setCalendarForm({ ...calendarForm, reason: event.target.value }) : setRequestForm({ ...requestForm, reason: event.target.value })} style={{ width: '100%', padding: '0.75rem', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text)' }} /></div>
          {!reviewer && <div className="form-group"><label>Evidence URL (optional)</label><input type="url" value={requestForm.evidenceUrl} onChange={event => setRequestForm({ ...requestForm, evidenceUrl: event.target.value })} placeholder="Paste a link to a medical certificate or supporting file" /></div>}
          {error && <p className="error-message">{error}</p>}
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving...' : reviewer ? 'Add to calendar' : 'Submit request'}</button>
        </form>
      </div>

      {reviewer && calendar.length > 0 && (
        <div className="card" style={{ marginBottom: '0.875rem' }}>
          <div className="card-title">Non-working calendar</div>
          {calendar.slice(0, 8).map(item => <div key={item.id} className="list-item"><strong style={{ textTransform: 'capitalize' }}>{item.exception_type}</strong><div style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>{formatDate(item.date_from)}–{formatDate(item.date_to)} · {item.company_name || 'All companies'}</div><div style={{ fontSize: '0.82rem' }}>{item.reason}</div></div>)}
        </div>
      )}

      <div className="card">
        <div className="card-title">{reviewer ? 'Student requests' : 'Requests and calendar'}</div>
        {loading ? <SkeletonPage variant="list" label="Loading requests" /> : items.length === 0 ? <EmptyState title="No attendance exceptions" sub="Nothing has been submitted yet." /> : items.map(item => (
          <div key={item.id} className="list-item" style={{ marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
              <strong style={{ textTransform: 'capitalize' }}>{item.exception_type}{reviewer && item.first_name ? ` · ${item.first_name} ${item.last_name}` : ''}</strong>
              <span className="badge" style={STATUS_STYLE[item.status]}>{item.status}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', margin: '0.25rem 0' }}>{formatDate(item.date_from)}–{formatDate(item.date_to)}{item.company_name ? ` · ${item.company_name}` : ''}</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-2)' }}>{item.reason}</div>
            {item.exception_type === 'correction' && (item.proposed_clock_in || item.proposed_clock_out) && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginTop: '0.35rem' }}>
                Proposed: {item.proposed_clock_in?.slice(0, 5) || 'unchanged'}–{item.proposed_clock_out?.slice(0, 5) || 'unchanged'}
              </div>
            )}
            {item.review_remarks && <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: '0.35rem' }}>Review: {item.review_remarks}</div>}
            {reviewer && item.status === 'pending' && <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}><button className="action-btn action-btn-primary" onClick={() => review(item.id, 'approved')}>Approve</button><button className="action-btn action-btn-danger" onClick={() => review(item.id, 'rejected')}>Reject</button></div>}
          </div>
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default AttendanceExceptionsPage;
