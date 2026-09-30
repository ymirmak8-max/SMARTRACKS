import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VectorIcon from './VectorIcon';
import { deleteAttendanceImage, getAttendanceReview, logAttendanceImageView, reviewAttendanceRecord } from '../../api/coordinator';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import SecureImage from './SecureImage';
import SkeletonPage from './Skeleton';

const dateLabel = value => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const timeLabel = value => value ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
const statusOf = record => String(record.anomaly_flag || '').startsWith('[REJECTED]') ? 'rejected' : record.anomaly_flag ? 'pending' : record.is_valid ? 'verified' : 'invalid';
const cleanFlag = flag => String(flag || '').replace(/^\[REJECTED\]\s*/, '');

const PHOTO_FIELDS = { clock_in: 'selfie_in_url', clock_out: 'selfie_out_url' };
const PHOTO_TITLES = { clock_in: 'Time-in photo', clock_out: 'Time-out photo' };
const badgeTone = (recordStatus) => recordStatus === 'pending' ? 'warning' : recordStatus === 'verified' ? 'success' : 'danger';
const badgeLabel = (recordStatus) => recordStatus === 'pending' ? 'Needs review' : recordStatus === 'verified' ? 'Verified' : 'Rejected';

const STATUS_FILTERS = [
  { key: 'pending', label: 'Needs review' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const AttendanceReviewCenter = ({ canDeleteImages = false, defaultStatus = 'pending', embedded = false, onToast = () => {} }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(defaultStatus);
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dateInputRef = useRef(null);

  const fmtDay = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '';
    return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAttendanceReview();
      setRecords(response.data.records || []);
    } catch (error) {
      onToast(error.response?.data?.message || 'Unable to load attendance records.', 'error');
    } finally { setLoading(false); }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => records.reduce((result, record) => {
    result[statusOf(record)] += 1;
    return result;
  }, { pending: 0, verified: 0, rejected: 0, invalid: 0 }), [records]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter(record => {
      const recordStatus = statusOf(record);
      const matchesStatus = status === 'all' || recordStatus === status || (status === 'rejected' && recordStatus === 'invalid');
      const matchesDate = !date || String(record.date || '').slice(0, 10) === date;
      const haystack = `${record.first_name} ${record.last_name} ${record.email} ${record.company_name}`.toLowerCase();
      return matchesStatus && matchesDate && (!needle || haystack.includes(needle));
    });
  }, [date, query, records, status]);

  const initialsOf = (r) => `${r.first_name?.[0] || ''}${r.last_name?.[0] || ''}`.toUpperCase() || '•';

  const openPhoto = async (record, imageType) => {
    const url = record[PHOTO_FIELDS[imageType]];
    if (!url) return;
    try {
      await logAttendanceImageView(url);
      setPhoto({ url, imageType, recordId: record.id, date: record.date, name: `${record.first_name} ${record.last_name}` });
    } catch (error) { onToast(error.response?.data?.message || 'Unable to open attendance image.', 'error'); }
  };

  const submitDecision = async () => {
    if (!selected || !decision || saving) return;
    if (decision === 'rejected' && !remarks.trim()) {
      onToast('Enter a reason before rejecting attendance.', 'error');
      return;
    }
    setSaving(true);
    try {
      const response = await reviewAttendanceRecord(selected.id, { decision, remarks: remarks.trim() });
      setRecords(current => current.map(record => record.id === selected.id ? { ...record, ...response.data.record } : record));
      setSelected(null); setDecision(null); setRemarks('');
      onToast(`Attendance ${decision}.`);
    } catch (error) { onToast(error.response?.data?.message || 'Unable to save the review.', 'error'); }
    finally { setSaving(false); }
  };

  const deletePhoto = async () => {
    if (!photo || saving) return;
    setSaving(true);
    try {
      await deleteAttendanceImage(photo.url);
      const field = PHOTO_FIELDS[photo.imageType];
      setRecords(current => current.map(record => record.id === photo.recordId ? { ...record, [field]: null } : record));
      setConfirmDelete(false); setPhoto(null);
      onToast('Attendance image deleted and recorded in Audit.');
    } catch (error) { onToast(error.response?.data?.message || 'Unable to delete attendance image.', 'error'); }
    finally { setSaving(false); }
  };

  const chipCount = key => key === 'all' ? records.length : key === 'rejected' ? counts.rejected + counts.invalid : counts[key];

  return (
    <div className="att">
      {!embedded ? (
        <section className="att-hero" aria-label="Attendance summary">
          <div className="att-hero-glow" aria-hidden="true" />
          <div className="att-hero-top">
            <div>
              <p className="att-eyebrow"><VectorIcon name="calendar" size={12} /> Attendance</p>
              <h1 className="att-title">{counts.pending === 0 ? 'All reviewed' : `${counts.pending} to review`}</h1>
              <p className="att-sub">{records.length} record{records.length === 1 ? '' : 's'} · {counts.verified} verified · {counts.rejected + counts.invalid} rejected</p>
            </div>
            <button type="button" className="att-refresh" onClick={load} disabled={loading} aria-label="Refresh attendance">
              <VectorIcon name="refresh" size={16} />
            </button>
          </div>
        </section>
      ) : (
        <div className="att-minihead">
          <strong>Attendance review</strong>
          <span>{counts.pending} need review</span>
          <button type="button" className="att-refresh is-sm" onClick={load} disabled={loading} aria-label="Refresh attendance">
            <VectorIcon name="refresh" size={15} />
          </button>
        </div>
      )}

      <div className="att-tabs" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map(filter => {
          const count = chipCount(filter.key);
          return (
            <button
              key={filter.key}
              type="button"
              className={`att-tab${status === filter.key ? ' is-on' : ''}`}
              aria-pressed={status === filter.key}
              onClick={() => setStatus(filter.key)}
            >
              {filter.label}{count > 0 ? <b>{count}</b> : null}
            </button>
          );
        })}
      </div>

      <div className="att-tools">
        <label className="att-search">
          <VectorIcon name="search" size={14} />
          <input
            type="search"
            placeholder="Search name or company…"
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label="Search attendance records"
          />
          {query && (
            <button type="button" className="att-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <VectorIcon name="x" size={14} />
            </button>
          )}
        </label>
        <div className="att-daterow">
          <button
            type="button"
            className={`att-datebtn${date ? ' is-set' : ''}`}
            onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}
          >
            <VectorIcon name="calendar" size={13} />
            {date ? fmtDay(date) : 'Any date'}
            <input
              ref={dateInputRef}
              type="date"
              value={date}
              onChange={event => setDate(event.target.value)}
              aria-label="Filter by date"
              tabIndex={-1}
            />
          </button>
          {date && (
            <button type="button" className="att-dateclear" onClick={() => setDate('')} aria-label="Clear date filter">
              <VectorIcon name="x" size={13} />
            </button>
          )}
        </div>
      </div>

    {loading ? <SkeletonPage variant="list" label="Loading attendance" /> : filtered.length === 0 ? <EmptyState title={status === 'pending' ? 'Nothing to review' : 'No matching records'} sub={status === 'pending' ? 'All caught up.' : 'Try another filter.'} /> :
      <div className="att-list">{filtered.map(record => {
        const recordStatus = statusOf(record);
        const photos = [
          record.selfie_in_url && { key: 'clock_in', label: 'Time in', time: timeLabel(record.clock_in), url: record.selfie_in_url },
          record.selfie_out_url && { key: 'clock_out', label: 'Time out', time: timeLabel(record.clock_out), url: record.selfie_out_url },
        ].filter(Boolean);
        return <article className="att-card" key={record.id}>
          <div className="att-card-head">
            <span className="att-ava" aria-hidden="true">{initialsOf(record)}</span>
            <div className="att-who">
              <strong>{record.first_name} {record.last_name}</strong>
              <small>{record.company_name} · {dateLabel(record.date)}</small>
            </div>
            <span className={`badge badge-${badgeTone(recordStatus)}`}>{badgeLabel(recordStatus)}</span>
          </div>
          {photos.length > 0 ? (
            <div className="att-photos" role="group" aria-label={`Photos of ${record.first_name} ${record.last_name}`}>
              {photos.map(photo => (
                <button key={photo.key} type="button" className="att-thumb" onClick={() => openPhoto(record, photo.key)} aria-label={`View ${photo.label} photo`}>
                  <SecureImage src={photo.url} alt={`${record.first_name} ${record.last_name} ${photo.label}`} />
                  <span>{photo.label} · {photo.time}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="att-nophoto">No student photos for this record.</p>
          )}
          <div className="att-facts">
            <div><span>In</span><strong>{timeLabel(record.clock_in)}</strong></div>
            <div><span>Out</span><strong>{timeLabel(record.clock_out)}</strong></div>
            <div><span>Hours</span><strong>{record.total_hours ? `${Number(record.total_hours).toFixed(2)}h` : '—'}</strong></div>
          </div>
          {!(record.clock_in_lat && record.clock_in_lng) && <p className="att-noloc"><VectorIcon name="map" size={13} /> No location captured</p>}
          {record.is_late ? <p className="att-late">Late by {record.late_minutes || 0} min</p> : null}
          {record.evidence_note && <p className="att-note">{record.evidence_note}</p>}
          {record.anomaly_flag && <p className={`att-reason${recordStatus === 'rejected' ? ' is-rejected' : ''}`}>{cleanFlag(record.anomaly_flag)}</p>}
          {recordStatus === 'pending' && (
            <div className="att-actions">
              <button type="button" className="att-approve" onClick={() => { setSelected(record); setDecision('approved'); setRemarks(''); }}>
                <VectorIcon name="check" size={15} /> Approve
              </button>
              <button type="button" className="att-reject" onClick={() => { setSelected(record); setDecision('rejected'); setRemarks(''); }}>
                <VectorIcon name="x" size={15} /> Reject
              </button>
            </div>
          )}
        </article>;
      })}</div>}

    {selected && <div className="modal-overlay" onClick={() => !saving && setSelected(null)}><div className="modal-content svt-sheet is-narrow" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}><div className="modal-handle" /><h2 className="modal-title">{decision === 'approved' ? 'Approve attendance?' : 'Reject attendance?'}</h2><p className="svt-sheet-sub">{selected.first_name} {selected.last_name} · {dateLabel(selected.date)}</p><div className="form-group"><label htmlFor="attendance-review-remarks">Remarks {decision === 'rejected' ? '(required)' : '(optional)'}</label><textarea id="attendance-review-remarks" rows="3" value={remarks} onChange={event => setRemarks(event.target.value)} placeholder={decision === 'rejected' ? 'Explain why this record is invalid' : 'Add an optional verification note'} /></div><div className="modal-actions grid-2"><button type="button" className="action-btn action-btn-gray" onClick={() => setSelected(null)} disabled={saving}>Cancel</button><button type="button" className={`action-btn ${decision === 'approved' ? 'action-btn-success' : 'action-btn-danger'}`} onClick={submitDecision} disabled={saving}>{saving ? 'Saving…' : decision === 'approved' ? 'Approve' : 'Reject'}</button></div></div></div>}

    {photo && <div className="modal-overlay attendance-photo-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setPhoto(null); }}><div className="modal-content attendance-photo-modal" role="dialog" aria-modal="true"><div className="attendance-photo-header"><div><h2 className="modal-title">{PHOTO_TITLES[photo.imageType]}</h2><p>{photo.name} · {dateLabel(photo.date)} · Access recorded in Audit</p></div><div className="attendance-photo-actions">{canDeleteImages && <button className="action-btn action-btn-danger" onClick={() => setConfirmDelete(true)}>Delete image</button>}<button className="action-btn action-btn-gray" onClick={() => setPhoto(null)}>Close</button></div></div><SecureImage className="attendance-photo-full" src={photo.url} alt={`${photo.name} attendance photo`} /></div></div>}
    <ConfirmDialog open={confirmDelete} title="Delete attendance image?" message="This permanently removes the protected image. Attendance times remain unchanged and deletion is recorded in Audit." confirmLabel={saving ? 'Deleting…' : 'Delete image'} danger onCancel={() => !saving && setConfirmDelete(false)} onConfirm={deletePhoto} />
    </div>
  );
};

export default AttendanceReviewCenter;
