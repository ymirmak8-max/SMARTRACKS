import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createCalendarException, getAttendanceRequests, getCalendarExceptions,
  getMyAttendanceExceptions, reviewAttendanceRequest, submitAttendanceRequest,
} from '../../api/attendanceExceptions';
import { getCompanies } from '../../api/deployments';
import EmptyState from './EmptyState';
import CollapsibleSection from './CollapsibleSection';
import DocViewerModal from './DocViewerModal';
import VectorIcon from './VectorIcon';
import { PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';
import useAuth from '../../hooks/useAuth';
import { formatStudentMeta, getStudentMeta, subscribeStudentMeta } from '../../utils/studentMeta';

const STATUS_STYLE = {
  pending: { background: 'var(--warning-light)', color: 'var(--warning)' },
  approved: { background: 'var(--success-light)', color: 'var(--success)' },
  rejected: { background: 'var(--danger-light)', color: 'var(--danger)' },
};

const formatDate = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString() : '';

/** Student-facing label. Backend still stores 'correction' — we show 'Excuse'. */
const typeLabel = (type) => {
  if (type === 'correction' || type === 'excuse') return 'Excuse';
  if (type === 'leave') return 'Leave';
  return type;
};
/** Convert the form's UI value back to the backend-accepted type. */
const toBackendType = (type) => (type === 'excuse' ? 'correction' : type);

const AttendanceExceptionsPage = ({ reviewer = false, embedded = false }) => {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const emptyRequest = { type: 'leave', dateFrom: '', dateTo: '', reason: '', proposedClockIn: '', proposedClockOut: '' };
  const [requestForm, setRequestForm] = useState(emptyRequest);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [evidenceViewer, setEvidenceViewer] = useState(null);
  const evidenceInputRef = useRef(null);
  const [calendarForm, setCalendarForm] = useState({ type: 'holiday', companyId: '', dateFrom: '', dateTo: '', reason: '' });
  const [studentMeta, setStudentMeta] = useState(() => getStudentMeta(user?.id));

  useEffect(() => {
    setStudentMeta(getStudentMeta(user?.id));
    return subscribeStudentMeta(({ userId, meta }) => {
      if (String(userId) === String(user?.id)) setStudentMeta(meta);
    });
  }, [user?.id]);

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
      await submitAttendanceRequest({
        ...requestForm,
        type: toBackendType(requestForm.type),
        dateTo: requestForm.dateTo || requestForm.dateFrom,
        evidenceUrl: evidenceFile?.dataUrl || null,
      });
      setRequestForm(emptyRequest);
      setEvidenceFile(null);
      showToast('Request submitted for review.'); await load();
    } catch (requestError) { setError(requestError.response?.data?.message || 'Failed to submit request.'); }
    finally { setSaving(false); }
  };

  const handleEvidencePick = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      setError('Only JPG, PNG photos or PDF files are allowed as evidence.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Evidence file must be smaller than 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError('');
      setEvidenceFile({ name: file.name, mime: file.type, dataUrl: reader.result });
    };
    reader.onerror = () => setError('That file could not be read.');
    reader.readAsDataURL(file);
  };

  const evidenceIsFile = (url) => String(url || '').startsWith('/api/files');
  const openEvidence = (item) => {
    if (!item?.evidence_url) return;
    if (evidenceIsFile(item.evidence_url)) {
      setEvidenceViewer({ url: item.evidence_url, name: `${typeLabel(item.exception_type)} evidence` });
    } else {
      window.open(item.evidence_url, '_blank', 'noopener');
    }
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

  if (reviewer) {
    const pendingCount = items.filter(item => item.status === 'pending').length;
    const sortedItems = [...items].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
    return (
      <div>
        {!embedded && <PageHeader title="Attendance exceptions" subtitle={`${pendingCount} pending`} />}

        <div className="card exception-requests-card">
          <div className="card-title coordinator-card-title">Requests <span className="badge badge-warning">{pendingCount} pending</span></div>
          {loading ? <SkeletonPage variant="list" label="Loading requests" /> : sortedItems.length === 0 ? <EmptyState title="No requests" sub="Nothing submitted yet." /> : (
            <ul className="coordinator-list">
              {sortedItems.map(item => (
                <li key={item.id} className="coordinator-list-row">
                  <div>
                    <strong>{item.first_name ? `${item.first_name} ${item.last_name}` : 'Student'} <span className="exception-type">{typeLabel(item.exception_type)}</span></strong>
                    <span className="coordinator-muted">
                      {formatDate(item.date_from)}{item.date_to && item.date_to !== item.date_from ? `–${formatDate(item.date_to)}` : ''}
                      {item.exception_type === 'correction' && (item.proposed_clock_in || item.proposed_clock_out)
                        ? ` · ${item.proposed_clock_in?.slice(0, 5) || '—'}–${item.proposed_clock_out?.slice(0, 5) || '—'}` : ''}
                    </span>
                    {item.reason && <span className="coordinator-quote">{item.reason}</span>}
                  </div>
                  <div className="coordinator-list-actions">
                    {item.evidence_url && (
                      <button type="button" className="action-btn action-btn-gray" onClick={() => openEvidence(item)}>
                        Evidence
                      </button>
                    )}
                    {item.status === 'pending' ? <>
                      <button type="button" className="action-btn action-btn-success" onClick={() => review(item.id, 'approved')}>Approve</button>
                      <button type="button" className="action-btn action-btn-danger" onClick={() => review(item.id, 'rejected')}>Reject</button>
                    </> : <span className="badge" style={STATUS_STYLE[item.status]}>{item.status}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <CollapsibleSection title="Holidays & closures" count={calendar.length} className="exception-calendar-collapse">
          {calendar.length > 0 && (
            <ul className="coordinator-list exception-calendar-list">
              {calendar.slice(0, 8).map(item => (
                <li key={item.id} className="coordinator-list-row">
                  <div>
                    <strong>{item.reason || item.exception_type}</strong>
                    <span className="coordinator-muted">{formatDate(item.date_from)}{item.date_to && item.date_to !== item.date_from ? `–${formatDate(item.date_to)}` : ''} · {item.company_name || 'All companies'}</span>
                  </div>
                  <span className="badge badge-gray exception-type">{item.exception_type}</span>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addCalendarDate} className="exception-calendar-form">
            <div className="grid-2">
              <div className="form-group">
                <label htmlFor="exception-type">Type</label>
                <select id="exception-type" value={calendarForm.type} onChange={event => setCalendarForm({ ...calendarForm, type: event.target.value })}>
                  <option value="holiday">Holiday</option><option value="closure">Company closure</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="exception-company">Company</label>
                <select id="exception-company" value={calendarForm.companyId} onChange={event => setCalendarForm({ ...calendarForm, companyId: event.target.value })}>
                  <option value="">All companies</option>
                  {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </div>
              <div className="form-group"><label htmlFor="exception-from">From *</label><input id="exception-from" type="date" required value={calendarForm.dateFrom} onChange={event => setCalendarForm({ ...calendarForm, dateFrom: event.target.value })} /></div>
              <div className="form-group"><label htmlFor="exception-to">To</label><input id="exception-to" type="date" value={calendarForm.dateTo} onChange={event => setCalendarForm({ ...calendarForm, dateTo: event.target.value })} /></div>
            </div>
            <div className="form-group"><label htmlFor="exception-reason">Name *</label><input id="exception-reason" required value={calendarForm.reason} onChange={event => setCalendarForm({ ...calendarForm, reason: event.target.value })} placeholder="e.g. Independence Day" /></div>
            {error && <p className="error-message">{error}</p>}
            <button className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Add date'}</button>
          </form>
        </CollapsibleSection>
        {evidenceViewer && (
          <DocViewerModal file={evidenceViewer} onClose={() => setEvidenceViewer(null)} />
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Student';
  const metaLine = formatStudentMeta(studentMeta);
  const pendingCount = items.filter(item => item.status === 'pending').length;
  const approvedCount = items.filter(item => item.status === 'approved').length;

  return (
    <div className="leave-form">
      <section className="leave-hero" aria-label="Leave and excuse form">
        <div className="leave-hero-bg" aria-hidden="true" />
        <p className="leave-eyebrow"><VectorIcon name="calendar" size={13} /> Attendance · Leave & excuse</p>
        <h1 className="leave-title">Leave & excuse form</h1>
        <p className="leave-identity">
          <VectorIcon name="user" size={14} />
          <span><strong>{fullName}</strong>{metaLine ? ` · ${metaLine}` : ''}</span>
        </p>
        <p className="leave-sub">File an approved leave or excuse a missed attendance record. Your coordinator reviews every request.</p>
        <div className="leave-stats">
          <div className="leave-stat"><strong>{pendingCount}</strong><span>Pending</span></div>
          <div className="leave-stat"><strong>{approvedCount}</strong><span>Approved</span></div>
          <div className="leave-stat"><strong>{items.length}</strong><span>Total filed</span></div>
        </div>
      </section>

      <div className="card leave-card">
        <div className="card-title">New request</div>
        <div className="leave-seg" role="group" aria-label="Request type">
          {[
            { value: 'leave', label: 'Leave', icon: 'calendar', hint: 'Planned absence' },
            { value: 'excuse', label: 'Excuse', icon: 'document', hint: 'Missed record' },
          ].map(option => (
            <button
              key={option.value}
              type="button"
              className={`leave-seg-btn${requestForm.type === option.value ? ' is-active' : ''}`}
              onClick={() => setRequestForm({ ...requestForm, type: option.value })}
              aria-pressed={requestForm.type === option.value}
            >
              <VectorIcon name={option.icon} size={17} />
              <span><strong>{option.label}</strong><small>{option.hint}</small></span>
            </button>
          ))}
        </div>
        <form onSubmit={submitRequest}>
          {requestForm.type === 'excuse' && (
            <div className="grid-2">
              <div className="form-group"><label>Correct Time In</label><input type="time" value={requestForm.proposedClockIn} onChange={event => setRequestForm({ ...requestForm, proposedClockIn: event.target.value })} /></div>
              <div className="form-group"><label>Correct Time Out</label><input type="time" value={requestForm.proposedClockOut} onChange={event => setRequestForm({ ...requestForm, proposedClockOut: event.target.value })} /></div>
            </div>
          )}
          <div className="grid-2">
            <div className="form-group"><label>From *</label><input type="date" required value={requestForm.dateFrom} onChange={event => setRequestForm({ ...requestForm, dateFrom: event.target.value })} /></div>
            <div className="form-group"><label>To</label><input type="date" value={requestForm.dateTo} onChange={event => setRequestForm({ ...requestForm, dateTo: event.target.value })} /></div>
          </div>
          <div className="form-group"><label>Reason *</label><textarea required rows={3} value={requestForm.reason} onChange={event => setRequestForm({ ...requestForm, reason: event.target.value })} placeholder={requestForm.type === 'leave' ? 'e.g. Family event on Saturday' : 'e.g. Forgot to time in — arrived 8:02 AM'} className="leave-reason" /></div>
          <div className="form-group">
            <label>Evidence <span className="leave-optional">(optional)</span></label>
            <input
              ref={evidenceInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              style={{ display: 'none' }}
              onChange={handleEvidencePick}
              aria-label="Attach evidence photo or file"
            />
            {evidenceFile ? (
              <div className="leave-evidence">
                {String(evidenceFile.mime || '').startsWith('image/') ? (
                  <img src={evidenceFile.dataUrl} alt="Evidence preview" className="leave-ev-thumb" />
                ) : (
                  <span className="leave-ev-file" aria-hidden="true"><VectorIcon name="document" size={18} /></span>
                )}
                <span className="leave-ev-name">{evidenceFile.name}</span>
                <button type="button" className="leave-ev-remove" onClick={() => setEvidenceFile(null)} aria-label="Remove evidence">
                  <VectorIcon name="x" size={14} />
                </button>
              </div>
            ) : (
              <button type="button" className="leave-attach" onClick={() => evidenceInputRef.current?.click()}>
                <VectorIcon name="upload" size={16} />
                <span><strong>Attach photo or file</strong><small>JPG, PNG or PDF · up to 5 MB</small></span>
              </button>
            )}
          </div>
          {error && <p className="error-message">{error}</p>}
          <button className="btn-primary" disabled={saving}>
            <span className="icon-label"><VectorIcon name={saving ? 'clock' : 'check'} size={16} /> {saving ? 'Submitting...' : `Submit ${requestForm.type === 'leave' ? 'leave' : 'excuse'}`}</span>
          </button>
        </form>
      </div>

      <div className="card leave-history-card">
        <div className="card-title">My requests</div>
        {loading ? <SkeletonPage variant="list" label="Loading requests" /> : items.length === 0 ? <EmptyState title="No requests yet" sub="Your leave and excuse requests will appear here." /> : (
          <ul className="leave-history-list">
            {items.map(item => (
              <li key={item.id} className={`leave-history-item is-${item.status}`}>
                <span className="leave-history-accent" aria-hidden="true" />
                <div className="leave-history-head">
                  <strong>{typeLabel(item.exception_type)}</strong>
                  <span className="badge" style={STATUS_STYLE[item.status]}>{item.status}</span>
                </div>
                <div className="leave-history-dates">{formatDate(item.date_from)}{item.date_to && item.date_to !== item.date_from ? ` – ${formatDate(item.date_to)}` : ''}{item.company_name ? ` · ${item.company_name}` : ''}</div>
                <div className="leave-history-reason">{item.reason}</div>
                {(item.proposed_clock_in || item.proposed_clock_out) && (
                  <div className="leave-history-proposed">
                    Proposed: {item.proposed_clock_in?.slice(0, 5) || 'unchanged'} – {item.proposed_clock_out?.slice(0, 5) || 'unchanged'}
                  </div>
                )}
                {item.review_remarks && <div className="leave-history-review">Review: {item.review_remarks}</div>}
                {item.evidence_url && (
                  <button type="button" className="leave-evidence-view" onClick={() => openEvidence(item)}>
                    <VectorIcon name="image" size={13} /> View evidence
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {evidenceViewer && (
        <DocViewerModal file={evidenceViewer} onClose={() => setEvidenceViewer(null)} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default AttendanceExceptionsPage;
