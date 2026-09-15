import { useCallback, useEffect, useMemo, useState } from 'react';
import VectorIcon from './VectorIcon';
import { deleteAttendanceImage, getAttendanceReview, logAttendanceImageView, reviewAttendanceRecord } from '../../api/coordinator';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import { MetricCard, PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';
import StudentTypeahead from './StudentTypeahead';

const dateLabel = value => value ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const timeLabel = value => value ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—';
const statusOf = record => String(record.anomaly_flag || '').startsWith('[REJECTED]') ? 'rejected' : record.anomaly_flag ? 'pending' : record.is_valid ? 'verified' : 'invalid';
const cleanFlag = flag => String(flag || '').replace(/^\[REJECTED\]\s*/, '');

const AttendanceReviewCenter = ({ canDeleteImages = false, onToast = () => {} }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('pending');
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const studentOptions = useMemo(() => {
    const unique = new Map();
    records.forEach((record) => {
      const id = record.student_id || record.email || `${record.first_name}-${record.last_name}`;
      if (!unique.has(id)) {
        unique.set(id, {
          id,
          first_name: record.first_name,
          last_name: record.last_name,
          email: record.email,
          company_name: record.company_name,
        });
      }
    });
    return [...unique.values()];
  }, [records]);

  const openPhoto = async (record, imageType) => {
    const url = imageType === 'clock_in' ? record.selfie_in_url : record.selfie_out_url;
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
      const field = photo.imageType === 'clock_in' ? 'selfie_in_url' : 'selfie_out_url';
      setRecords(current => current.map(record => record.id === photo.recordId ? { ...record, [field]: null } : record));
      setConfirmDelete(false); setPhoto(null);
      onToast('Attendance image deleted and recorded in Audit.');
    } catch (error) { onToast(error.response?.data?.message || 'Unable to delete attendance image.', 'error'); }
    finally { setSaving(false); }
  };

  return <>
    <PageHeader eyebrow="Verification" title="Attendance Review Center" subtitle="Review attendance evidence, location accuracy, and flagged records in one place." actions={
      <button type="button" className="action-btn action-btn-gray icon-label" onClick={load} disabled={loading}><VectorIcon name="refresh" size={16} /> Refresh</button>
    } />

    <div className="stat-grid stat-grid-3 attendance-review-metrics">
      <MetricCard label="Needs review" value={counts.pending} />
      <MetricCard label="Verified" value={counts.verified} />
      <MetricCard label="Rejected" value={counts.rejected + counts.invalid} />
    </div>

    <div className="card attendance-review-toolbar">
      <StudentTypeahead
        id="attendance-find-student"
        students={studentOptions}
        value={query}
        onChange={setQuery}
        label="Find student"
        placeholder="Type a name to see matching students"
      />
      <label><span>Date</span><input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label><span><VectorIcon name="filter" size={14} /> Status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="pending">Needs review</option><option value="all">All records</option><option value="verified">Verified</option><option value="rejected">Rejected</option></select></label>
    </div>

    {loading ? <SkeletonPage variant="list" label="Loading attendance" /> : filtered.length === 0 ? <EmptyState title="No matching attendance" sub="Try another filter, or refresh after students time in." /> :
      <div className="attendance-review-list">{filtered.map(record => {
        const recordStatus = statusOf(record);
        return <article className="card attendance-review-card" key={record.id}>
          <div className="attendance-review-card-head"><div><h3>{record.first_name} {record.last_name}</h3><p>{record.company_name} · {dateLabel(record.date)}</p></div><span className={`badge attendance-status-${recordStatus}`}>{recordStatus === 'pending' ? 'Needs review' : recordStatus}</span></div>
          <div className="attendance-review-facts">
            <div><span>Time in</span><strong>{timeLabel(record.clock_in)}</strong></div><div><span>Time out</span><strong>{timeLabel(record.clock_out)}</strong></div><div><span>Hours</span><strong>{record.total_hours ? `${Number(record.total_hours).toFixed(2)}h` : '—'}</strong></div><div><span>Location</span><strong>{record.clock_in_lat && record.clock_in_lng ? <><VectorIcon name="map" size={14} /> Captured</> : 'Missing'}</strong></div>
          </div>
          {record.anomaly_flag && <div className={`attendance-review-reason ${recordStatus === 'rejected' ? 'is-rejected' : ''}`}>{cleanFlag(record.anomaly_flag)}</div>}
          <div className="attendance-review-actions">
            {record.selfie_in_url && <button className="action-btn action-btn-gray icon-label" onClick={() => openPhoto(record, 'clock_in')}><VectorIcon name="image" size={16} /> Time-in photo</button>}
            {record.selfie_out_url && <button className="action-btn action-btn-gray icon-label" onClick={() => openPhoto(record, 'clock_out')}><VectorIcon name="image" size={16} /> Time-out photo</button>}
            {recordStatus === 'pending' && <><button className="action-btn action-btn-success icon-label" onClick={() => { setSelected(record); setDecision('approved'); setRemarks(''); }}><VectorIcon name="check" size={16} /> Approve</button><button className="action-btn action-btn-danger icon-label" onClick={() => { setSelected(record); setDecision('rejected'); setRemarks(''); }}><VectorIcon name="x" size={16} /> Reject</button></>}
          </div>
        </article>;
      })}</div>}

    {selected && <div className="modal-overlay"><div className="modal-content attendance-review-decision" role="dialog" aria-modal="true"><div className="modal-handle" /><h2 className="modal-title">{decision === 'approved' ? 'Approve attendance?' : 'Reject attendance?'}</h2><p>{selected.first_name} {selected.last_name} · {dateLabel(selected.date)}</p><div className="form-group"><label htmlFor="attendance-review-remarks">Remarks {decision === 'rejected' ? '(required)' : '(optional)'}</label><textarea id="attendance-review-remarks" rows="3" value={remarks} onChange={event => setRemarks(event.target.value)} placeholder={decision === 'rejected' ? 'Explain why this record is invalid' : 'Add an optional verification note'} /></div><div className="modal-actions grid-2"><button className="action-btn action-btn-gray" onClick={() => setSelected(null)} disabled={saving}>Cancel</button><button className={`action-btn ${decision === 'approved' ? 'action-btn-success' : 'action-btn-danger'}`} onClick={submitDecision} disabled={saving}>{saving ? 'Saving…' : decision === 'approved' ? 'Confirm approval' : 'Confirm rejection'}</button></div></div></div>}

    {photo && <div className="modal-overlay attendance-photo-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setPhoto(null); }}><div className="modal-content attendance-photo-modal" role="dialog" aria-modal="true"><div className="attendance-photo-header"><div><h2 className="modal-title">{photo.imageType === 'clock_in' ? 'Time-in' : 'Time-out'} photo</h2><p>{photo.name} · {dateLabel(photo.date)} · Access recorded in Audit</p></div><div className="attendance-photo-actions">{canDeleteImages && <button className="action-btn action-btn-danger" onClick={() => setConfirmDelete(true)}>Delete image</button>}<button className="action-btn action-btn-gray" onClick={() => setPhoto(null)}>Close</button></div></div><img className="attendance-photo-full" src={photo.url} alt={`${photo.name} attendance evidence`} /></div></div>}
    <ConfirmDialog open={confirmDelete} title="Delete attendance image?" message="This permanently removes the protected image. Attendance times remain unchanged and deletion is recorded in Audit." confirmLabel={saving ? 'Deleting…' : 'Delete image'} danger onCancel={() => !saving && setConfirmDelete(false)} onConfirm={deletePhoto} />
  </>;
};

export default AttendanceReviewCenter;
