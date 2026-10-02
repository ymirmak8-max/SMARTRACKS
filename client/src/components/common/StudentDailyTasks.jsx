import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyDailyTasks, updateMyDailyTask } from '../../api/dailyTasks';
import EmptyState from './EmptyState';
import VectorIcon from './VectorIcon';
import { StatusBadge } from './DashboardUI';
import SkeletonPage from './Skeleton';
import SecureImage from './SecureImage';
import { validateSelfie } from '../../utils/selfieCheck';

const todayInManila = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const statusTone = {
  missing: 'danger',
  in_progress: 'warning',
  completed: 'success',
  excused: 'gray',
};

const statusLabel = (status) => String(status || 'missing').replace('_', ' ');

const formatTaskDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });
};

const StudentDailyTasks = ({ onToast = () => {}, compact = false, onOpenAll }) => {
  const [date, setDate] = useState(todayInManila);
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ missing: 0, in_progress: 0, completed: 0, excused: 0 });
  const [availableDates, setAvailableDates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const userPickedDate = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMyDailyTasks(date);
      const nextTasks = response.data.tasks || [];
      const nextDates = response.data.availableDates || [];
      setTasks(nextTasks);
      setCounts(response.data.counts || { missing: 0, in_progress: 0, completed: 0, excused: 0 });
      setAvailableDates(nextDates);
      if (!compact && !userPickedDate.current && !nextTasks.length && nextDates[0] && nextDates[0] !== date) {
        setDate(nextDates[0]);
      }
    } catch (error) {
      onToast(error.response?.data?.message || 'Unable to load daily tasks.', 'error');
    } finally { setLoading(false); }
  }, [compact, date, onToast]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (task, status) => {
    if (savingId) return;
    setSavingId(task.id);
    try {
      const response = await updateMyDailyTask(task.id, { status });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...response.data.task } : item));
      setCounts((current) => {
        const next = { ...current };
        next[task.status] = Math.max(0, (next[task.status] || 0) - 1);
        next[status] = (next[status] || 0) + 1;
        return next;
      });
      onToast(response.data.message);
    } catch (error) {
      onToast(error.response?.data?.message || 'Unable to update this task.', 'error');
    } finally { setSavingId(''); }
  };

  const [filter, setFilter] = useState('all');
  const [proofTask, setProofTask] = useState(null);
  const [proofImage, setProofImage] = useState(null);
  const [proofCheck, setProofCheck] = useState(null);
  const [proofChecking, setProofChecking] = useState(false);
  const [proofError, setProofError] = useState('');

  const openProofModal = (task) => {
    setProofTask(task);
    setProofImage(task.proof_image_url || null);
    setProofCheck(null);
    setProofError('');
  };

  const closeProofModal = () => {
    if (savingId) return;
    setProofTask(null);
    setProofImage(null);
    setProofCheck(null);
    setProofError('');
  };

  const handleProofFile = (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setProofError('Photo proof must be a JPG or PNG image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProofError('Photo proof must be smaller than 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setProofImage(dataUrl);
      setProofError('');
      setProofCheck(null);
      setProofChecking(true);
      try {
        const result = await validateSelfie(dataUrl);
        setProofCheck(result);
        if (!result.ok) setProofError(result.reason || 'Face check failed. Retake with your face visible.');
      } catch {
        setProofError('Could not run the face check. Try another photo.');
      } finally {
        setProofChecking(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const submitProof = async () => {
    if (!proofTask || savingId || proofChecking) return;
    if (!proofImage) {
      setProofError('Upload a photo proof with your face before submitting.');
      return;
    }
    if (proofCheck && !proofCheck.ok) {
      setProofError(proofCheck.reason || 'Face check failed. Retake with your face visible.');
      return;
    }
    setSavingId(proofTask.id);
    setProofError('');
    try {
      const isDataUrl = String(proofImage).startsWith('data:');
      const response = await updateMyDailyTask(proofTask.id, {
        status: 'completed',
        ...(isDataUrl ? { proofImage } : {}),
      });
      setTasks((current) => current.map((item) => item.id === proofTask.id ? { ...item, ...response.data.task } : item));
      setCounts((current) => {
        const next = { ...current };
        next[proofTask.status] = Math.max(0, (next[proofTask.status] || 0) - 1);
        next.completed = (next.completed || 0) + 1;
        return next;
      });
      onToast(response.data.message);
      closeProofModal();
    } catch (error) {
      setProofError(error.response?.data?.message || 'Unable to submit this task.');
    } finally {
      setSavingId('');
    }
  };

  if (compact) {
    const openCount = counts.missing + counts.in_progress;
    const status = tasks.length === 0 ? 'none' : counts.missing > 0 ? 'attention' : 'good';
    const detail = openCount
      ? `${openCount} still open`
      : tasks.length
        ? 'All caught up'
        : 'No tasks assigned';
    return (
      <button
        type="button"
        className={`ojt-task-strip ojt-task-strip-${status}`}
        onClick={onOpenAll}
        aria-label={`Open daily tasks. ${tasks.length} tasks today. ${detail}.`}
      >
        <span className="ojt-task-strip-icon" aria-hidden="true">
          <VectorIcon name="clipboard" size={19} />
        </span>
        <span className="ojt-task-strip-copy">
          <strong>{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} today</strong>
          <small>{detail}</small>
        </span>
        {counts.missing > 0 && (
          <span className="ojt-task-strip-missing">
            <VectorIcon name="alert" size={12} /> {counts.missing} missing
          </span>
        )}
        <VectorIcon name="chevronRight" size={18} className="ojt-task-strip-go" />
      </button>
    );
  }

  const visibleTasks = filter === 'all' ? tasks : tasks.filter(task => task.status === filter);
  const doneCount = counts.completed + counts.excused;
  const totalCount = tasks.length;
  const donePercent = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="tasks-page">
      <section className="tasks-hero" aria-label="Daily tasks summary">
        <div className="tasks-hero-bg" aria-hidden="true" />
        <p className="tasks-eyebrow"><VectorIcon name="clipboard" size={13} /> Today's work</p>
        <h1 className="tasks-title">Daily tasks</h1>
        <p className="tasks-sub">
          {totalCount === 0
            ? 'No tasks assigned for this date.'
            : doneCount === totalCount
              ? 'All caught up — nice work.'
              : `${totalCount - doneCount} of ${totalCount} still open.`}
        </p>
        {totalCount > 0 && (
          <div className="tasks-progress" role="progressbar" aria-valuenow={donePercent} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks completed">
            <div className="tasks-progress-fill" style={{ width: `${donePercent}%` }} />
          </div>
        )}
      </section>

      <div className="tasks-filters" role="group" aria-label="Filter tasks by status">
        {[
          { value: 'all', label: 'All', count: totalCount },
          { value: 'missing', label: 'Missing', count: counts.missing },
          { value: 'in_progress', label: 'Active', count: counts.in_progress },
          { value: 'completed', label: 'Done', count: counts.completed },
          { value: 'excused', label: 'Excused', count: counts.excused },
        ].map(option => (
          <button
            key={option.value}
            type="button"
            className={`tasks-filter${filter === option.value ? ' is-active' : ''}`}
            onClick={() => setFilter(option.value)}
            aria-pressed={filter === option.value}
          >
            {option.label}
            <span className="tasks-filter-count">{option.count}</span>
          </button>
        ))}
      </div>

      <div className="card tasks-date-card">
        <label className="tasks-date-field">
          <span>Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => {
              userPickedDate.current = true;
              setDate(event.target.value);
            }}
          />
        </label>
        {availableDates.length > 0 && (
          <div className="tasks-date-chips">
            {availableDates.map((item) => (
              <button
                key={item}
                type="button"
                className={`tasks-date-chip${item === date ? ' is-active' : ''}`}
                onClick={() => {
                  userPickedDate.current = true;
                  setDate(item);
                }}
              >
                {formatTaskDate(item)}
              </button>
            ))}
          </div>
        )}
      </div>
      {loading ? <SkeletonPage variant="list" label="Loading tasks" /> : tasks.length === 0 ? (
        <EmptyState
          title="No tasks for this date"
          sub={availableDates.length
            ? `Your supervisor assigned work on ${availableDates.map(formatTaskDate).join(', ')}.`
            : 'Your company supervisor will assign daily OJT work here.'}
        />
      ) : visibleTasks.length === 0 ? (
        <EmptyState title="Nothing here" sub="No tasks match this filter for the selected date." />
      ) : visibleTasks.map((task) => (
        <article className={`task-card is-${task.status}`} key={task.id}>
          <span className="task-card-icon" aria-hidden="true">
            <VectorIcon
              name={task.status === 'completed' ? 'check' : task.status === 'in_progress' ? 'clock' : task.status === 'excused' ? 'x' : 'alert'}
              size={17}
            />
          </span>
          <div className="task-card-copy">
            <div className="task-card-head">
              <h3>{task.title}</h3>
              <StatusBadge tone={statusTone[task.status] || 'gray'}>{statusLabel(task.status)}</StatusBadge>
            </div>
            {task.description && <p className="task-card-desc">{task.description}</p>}
            {task.task_date && String(task.task_date).slice(0, 10) !== date && (
              <p className="task-card-meta">Assigned {formatTaskDate(task.task_date)}</p>
            )}
            {task.excuse_remarks && <p className="task-card-note">Excused: {task.excuse_remarks}</p>}
            {task.proof_image_url && (
              <button type="button" className="task-proof-thumb" onClick={() => openProofModal(task)} aria-label="View submitted photo proof">
                <SecureImage src={task.proof_image_url} alt="Submitted photo proof" />
                <span>Photo proof submitted · tap to view</span>
              </button>
            )}
            {task.status !== 'excused' && task.status !== 'completed' && (
              <div className="task-card-actions">
                {task.status === 'missing' && (
                  <button type="button" className="task-btn" disabled={savingId === task.id} onClick={() => updateStatus(task, 'in_progress')}>
                    Start
                  </button>
                )}
                <button type="button" className="task-btn is-done" disabled={savingId === task.id} onClick={() => openProofModal(task)}>
                  {savingId === task.id ? 'Saving…' : 'Mark done'}
                </button>
              </div>
            )}
          </div>
        </article>
      ))}

      {proofTask && (
        <div className="modal-overlay" onClick={closeProofModal}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-label="Submit task with photo proof"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-handle" />
            <div className="notif-modal-head">
              <strong>Photo proof · {proofTask.title}</strong>
              <button type="button" onClick={closeProofModal} aria-label="Close proof">
                <VectorIcon name="x" size={15} />
              </button>
            </div>
            <p className="task-proof-sub">
              Upload a clear photo with your face visible. Face detection runs on your device before submit.
            </p>
            {proofImage ? (
              <div className="task-proof-preview">
                {String(proofImage).startsWith('data:') ? (
                  <img src={proofImage} alt="Photo proof preview" />
                ) : (
                  <SecureImage src={proofImage} alt="Submitted photo proof" />
                )}
                <label className="task-proof-replace">
                  Replace photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    style={{ display: 'none' }}
                    onChange={(e) => handleProofFile(e.target.files?.[0])}
                  />
                </label>
              </div>
            ) : (
              <label className="task-proof-drop">
                <VectorIcon name="camera" size={28} />
                <span>Tap to upload a photo (JPG/PNG, max 5 MB)</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  style={{ display: 'none' }}
                  onChange={(e) => handleProofFile(e.target.files?.[0])}
                />
              </label>
            )}
            {proofChecking && <p className="task-proof-checking" role="status">Checking face… blur and face detection…</p>}
            {proofCheck?.ok && (
              <p className="task-proof-pass" role="status">
                <VectorIcon name="check" size={14} />
                <span>
                  Face detected{typeof proofCheck.faceCount === 'number' ? ` · ${proofCheck.faceCount} face${proofCheck.faceCount === 1 ? '' : 's'}` : ''}
                  {typeof proofCheck.blurScore === 'number' ? ` · sharpness ${proofCheck.blurScore}` : ''}
                </span>
              </p>
            )}
            {proofError && <p className="error-message" role="alert">{proofError}</p>}
            <div className="modal-actions grid-2" style={{ marginTop: '0.75rem' }}>
              <button type="button" className="action-btn action-btn-gray" onClick={closeProofModal} disabled={!!savingId}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ margin: 0 }}
                disabled={!!savingId || proofChecking || !proofImage}
                onClick={submitProof}
              >
                {savingId ? 'Submitting…' : 'Submit task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDailyTasks;
