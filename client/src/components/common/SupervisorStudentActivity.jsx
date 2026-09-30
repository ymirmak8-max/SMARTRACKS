import { useCallback, useEffect, useMemo, useState } from 'react';
import { getStudentActivity } from '../../api/supervisor';
import { logAttendanceImageView } from '../../api/coordinator';
import EmptyState from './EmptyState';
import { StatusBadge, safePercent } from './DashboardUI';
import SecureImage from './SecureImage';
import SkeletonPage from './Skeleton';
import VectorIcon from './VectorIcon';

const todayInManila = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const dayLabel = (key) => {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '—';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
};

const timeLabel = (value) => (value
  ? new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
  : '—');

const hoursLabel = (value) => (value == null || value === '' ? '—' : `${Number(value).toFixed(2)}h`);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortTime = (value) => String(value || '').slice(0, 5);

const recordStatus = (record, today) => {
  const flag = String(record.anomaly_flag || '');
  if (flag.startsWith('[REJECTED]')) return { label: 'Rejected', tone: 'danger' };
  if (record.clock_in && !record.clock_out) {
    return String(record.date).slice(0, 10) === today
      ? { label: 'Timed in', tone: 'success' }
      : { label: 'No time-out', tone: 'warning' };
  }
  if (flag) return { label: 'Flagged', tone: 'danger' };
  if (record.is_late) return { label: `Late ${record.late_minutes || 0}m`, tone: 'warning' };
  return { label: 'Present', tone: 'success' };
};

const TASK_TONES = { missing: 'danger', in_progress: 'warning', completed: 'success', excused: 'gray' };

const recordPhotos = (record) => [
  record.selfie_in_url && { key: 'clock_in', label: 'Time-in photo', url: record.selfie_in_url },
  record.selfie_out_url && { key: 'clock_out', label: 'Time-out photo', url: record.selfie_out_url },
].filter(Boolean);

const SupervisorStudentActivity = ({ students = [], studentId, onSelectStudent, onToast = () => {} }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('attendance');
  const [viewer, setViewer] = useState(null);
  const today = todayInManila();

  const load = useCallback(async () => {
    if (!studentId) { setData(null); return; }
    setLoading(true);
    setError('');
    try {
      const response = await getStudentActivity(studentId);
      setData(response.data);
    } catch (requestError) {
      setData(null);
      setError(requestError.response?.data?.message || 'Unable to load this trainee’s activity.');
    } finally { setLoading(false); }
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  const timeline = useMemo(() => {
    if (!data) return [];
    const entries = [
      ...(data.records || []).map((record) => ({ type: 'record', date: String(record.date).slice(0, 10), record })),
      ...(data.missedDays || []).map((date) => ({ type: 'missed', date })),
    ];
    return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [data]);

  const openPhotos = async (record, startKey) => {
    const photos = recordPhotos(record);
    if (!photos.length) return;
    try {
      await Promise.all(photos.map((photo) => logAttendanceImageView(photo.url)));
    } catch (logError) {
      onToast(logError.response?.data?.message || 'Unable to open these photos.', 'error');
      return;
    }
    setViewer({ date: record.date, photos, active: startKey || photos[0].key });
  };

  const student = data?.student;
  const totals = data?.totals;
  const schedule = student
    ? `${(student.work_days || []).map((day) => WEEKDAYS[Number(day)]).filter(Boolean).join(', ') || 'Mon–Fri'} · ${shortTime(student.work_start_time) || '08:00'}–${shortTime(student.work_end_time) || '17:00'}`
    : '';
  const activePhoto = viewer?.photos.find((photo) => photo.key === viewer.active) || viewer?.photos[0];
  const progress = totals ? safePercent(totals.hoursRendered, totals.requiredHours) : 0;
  const statItems = totals ? [
    { label: 'Hours', value: `${totals.hoursRendered.toFixed(1)}h` },
    { label: 'Present', value: totals.daysPresent },
    { label: 'Late', value: totals.daysLate },
    { label: 'Missed', value: totals.daysMissed },
  ] : [];

  return (
    <>
      <section className="sup-activity-hero" aria-label="Trainee activity">
        <div className="sup-activity-hero-bg" aria-hidden="true" />
        <div className="sup-activity-top">
          <div>
            <p className="sup-activity-eyebrow"><VectorIcon name="activity" size={13} /> Supervisor · Activity</p>
            <h1 className="sup-activity-title">Trainee activity</h1>
          </div>
          {studentId && (
            <button type="button" className="sup-activity-refresh" onClick={load} disabled={loading} aria-label="Refresh activity">
              <VectorIcon name="refresh" size={17} />
            </button>
          )}
        </div>
        <label className="sup-activity-pick">
          <span>Trainee</span>
          <select
            value={studentId || ''}
            onChange={(event) => onSelectStudent?.(event.target.value || null)}
          >
            <option value="">Select a trainee…</option>
            {students.map((item) => (
              <option key={item.id} value={item.id}>{item.first_name} {item.last_name}</option>
            ))}
          </select>
        </label>
        {student && totals && (
          <>
            <div className="sup-activity-who">
              <div className="sup-activity-who-copy">
                <strong>{student.first_name} {student.last_name}</strong>
                <small>{student.email}{student.company_name ? ` · ${student.company_name}` : ''}</small>
                <small className="sup-activity-schedule"><VectorIcon name="clock" size={12} /> {schedule}</small>
              </div>
              <div className="sup-activity-pct">
                <strong>{progress.toFixed(0)}%</strong>
                <small>{totals.hoursRendered.toFixed(1)}h of {totals.requiredHours}h</small>
              </div>
            </div>
            <div className="sup-activity-bar" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Hours progress">
              <div className="sup-activity-fill" style={{ width: `${progress}%` }} />
            </div>
            <ul className="sup-activity-stats">
              {statItems.map(item => (
                <li key={item.label}><strong>{item.value}</strong><span>{item.label}</span></li>
              ))}
            </ul>
          </>
        )}
      </section>

      {!studentId ? (
        <EmptyState type="students" title="Choose a trainee" sub={students.length ? 'Pick a trainee above to see their daily activity.' : 'No trainees are assigned to you yet.'} />
      ) : loading && !data ? (
        <SkeletonPage variant="list" label="Loading activity" />
      ) : error ? (
        <div className="live-map-error"><VectorIcon name="alert" size={16} /> {error}</div>
      ) : student ? (
        <>
          <div className="sup-activity-tabs" role="tablist" aria-label="Activity sections">
            {[['attendance', 'Attendance'], ['tasks', `Tasks · ${(data.tasks || []).length}`]].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`sup-activity-tab${tab === key ? ' is-active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'attendance' ? (
            timeline.length === 0 ? (
              <EmptyState type="dtr" title="No attendance yet" sub="Records appear here after the trainee times in." />
            ) : (
              <div className="sup-day-list">
                {timeline.map((entry) => {
                  if (entry.type === 'missed') {
                    return (
                      <article className="sup-day is-missed" key={`missed-${entry.date}`}>
                        <div className="sup-day-head">
                          <strong>{dayLabel(entry.date)}</strong>
                          <StatusBadge tone="danger">No time-in</StatusBadge>
                        </div>
                        <p className="sup-day-muted">Scheduled workday, no record, no approved leave.</p>
                      </article>
                    );
                  }
                  const { record } = entry;
                  const status = recordStatus(record, today);
                  const photos = recordPhotos(record);
                  return (
                    <article className="sup-day" key={record.id}>
                      <div className="sup-day-head">
                        <strong>{dayLabel(record.date)}</strong>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                      <div className="sup-day-facts">
                        <div><span>In</span><strong>{timeLabel(record.clock_in)}</strong></div>
                        <div><span>Out</span><strong>{timeLabel(record.clock_out)}</strong></div>
                        <div><span>Hours</span><strong>{hoursLabel(record.total_hours)}</strong></div>
                        <div><span>Site</span><strong>{record.clock_in_worksite || record.clock_out_worksite || '—'}</strong></div>
                      </div>
                      {record.anomaly_flag && (
                        <p className="sup-day-flag">{String(record.anomaly_flag).replace(/^\[REJECTED\]\s*/, '')}</p>
                      )}
                      <div className="att-photos">
                        {photos.length ? photos.map((photo) => (
                          <button
                            key={photo.key}
                            type="button"
                            className="att-thumb"
                            onClick={() => openPhotos(record, photo.key)}
                            aria-label={`View ${photo.label}`}
                          >
                            <SecureImage src={photo.url} alt={`${photo.label} for ${dayLabel(record.date)}`} />
                            <span>{photo.label}</span>
                          </button>
                        )) : <span className="sup-day-muted">No photos</span>}
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : (data.tasks || []).length === 0 ? (
            <EmptyState type="evaluations" title="No daily tasks" sub="Tasks you assign from the Tasks tab appear here." />
          ) : (
            <div className="sup-day-list">
              {data.tasks.map((task) => (
                <article className="sup-day" key={task.id}>
                  <div className="sup-day-head">
                    <strong>{task.title}</strong>
                    <StatusBadge tone={TASK_TONES[task.status] || 'gray'}>{String(task.status).replace('_', ' ')}</StatusBadge>
                  </div>
                  <p className="sup-day-muted">{dayLabel(task.task_date)}</p>
                  {task.description && <p className="sup-day-note">{task.description}</p>}
                  {task.student_notes && <p className="sup-day-note"><strong>Note:</strong> {task.student_notes}</p>}
                  {task.excuse_remarks && <p className="sup-day-muted">Excused: {task.excuse_remarks}</p>}
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}

      {viewer && activePhoto && (
        <div className="modal-overlay attendance-photo-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewer(null); }}>
          <div className="modal-content attendance-photo-modal" role="dialog" aria-modal="true" aria-label="Attendance photos">
            <div className="attendance-photo-header">
              <div>
                <h2 className="modal-title">{activePhoto.label}</h2>
                <p>{student ? `${student.first_name} ${student.last_name} · ` : ''}{dayLabel(viewer.date)} · Access recorded in Audit</p>
              </div>
              <div className="attendance-photo-actions">
                <button type="button" className="action-btn action-btn-gray" onClick={() => setViewer(null)}>Close</button>
              </div>
            </div>
            {viewer.photos.length > 1 && (
              <div className="activity-tabs activity-photo-tabs">
                {viewer.photos.map((photo) => (
                  <button
                    key={photo.key}
                    type="button"
                    className={`activity-tab${photo.key === activePhoto.key ? ' is-active' : ''}`}
                    onClick={() => setViewer({ ...viewer, active: photo.key })}
                  >
                    {photo.label}
                  </button>
                ))}
              </div>
            )}
            <SecureImage className="attendance-photo-full" src={activePhoto.url} alt={`${activePhoto.label} for ${dayLabel(viewer.date)}`} />
          </div>
        </div>
      )}
    </>
  );
};

export default SupervisorStudentActivity;
