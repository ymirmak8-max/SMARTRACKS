import { useCallback, useEffect, useState } from 'react';
import { getStudentActivity } from '../../api/supervisor';
import EmptyState from './EmptyState';
import { StatusBadge, safePercent } from './DashboardUI';
import DocViewerModal from './DocViewerModal';
import SecureImage from './SecureImage';
import SkeletonPage from './Skeleton';
import VectorIcon from './VectorIcon';

const dayLabel = (key) => {
  const match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '—';
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortTime = (value) => String(value || '').slice(0, 5);

const TASK_TONES = { missing: 'danger', in_progress: 'warning', completed: 'success', excused: 'gray' };

const SupervisorStudentActivity = ({ students = [], studentId, onSelectStudent }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [proofViewer, setProofViewer] = useState(null);

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

  const student = data?.student;
  const totals = data?.totals;
  const schedule = student
    ? `${(student.work_days || []).map((day) => WEEKDAYS[Number(day)]).filter(Boolean).join(', ') || 'Mon–Fri'} · ${shortTime(student.work_start_time) || '08:00'}–${shortTime(student.work_end_time) || '17:00'}`
    : '';
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
        (data.tasks || []).length === 0 ? (
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
                {task.proof_image_url && (
                  <button
                    type="button"
                    className="svt-proof"
                    onClick={() => setProofViewer({ url: task.proof_image_url, name: `${task.title} · photo proof` })}
                  >
                    <SecureImage src={task.proof_image_url} alt="" />
                    <span>Photo proof</span>
                  </button>
                )}
              </article>
            ))}
          </div>
        )
      ) : null}
      {proofViewer && (
        <DocViewerModal file={proofViewer} onClose={() => setProofViewer(null)} />
      )}
    </>
  );
};

export default SupervisorStudentActivity;
