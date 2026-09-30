import { useCallback, useEffect, useRef, useState } from 'react';
import { getMyDailyTasks, updateMyDailyTask } from '../../api/dailyTasks';
import EmptyState from './EmptyState';
import VectorIcon from './VectorIcon';
import { StatusBadge } from './DashboardUI';
import SkeletonPage from './Skeleton';

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
            {task.status !== 'excused' && task.status !== 'completed' && (
              <div className="task-card-actions">
                {task.status === 'missing' && (
                  <button type="button" className="task-btn" disabled={savingId === task.id} onClick={() => updateStatus(task, 'in_progress')}>
                    Start
                  </button>
                )}
                <button type="button" className="task-btn is-done" disabled={savingId === task.id} onClick={() => updateStatus(task, 'completed')}>
                  {savingId === task.id ? 'Saving…' : 'Mark done'}
                </button>
              </div>
            )}
          </div>
        </article>
      ))}
    </div>
  );
};

export default StudentDailyTasks;
