import { useCallback, useEffect, useState } from 'react';
import { getMyDailyTasks, updateMyDailyTask } from '../../api/dailyTasks';
import EmptyState from './EmptyState';
import { MetricCard, PageHeader, StatusBadge } from './DashboardUI';
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

const StudentDailyTasks = ({ onToast = () => {}, compact = false, onOpenAll }) => {
  const [date, setDate] = useState(todayInManila);
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ missing: 0, in_progress: 0, completed: 0, excused: 0 });
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMyDailyTasks(date);
      setTasks(response.data.tasks || []);
      setCounts(response.data.counts || { missing: 0, in_progress: 0, completed: 0, excused: 0 });
    } catch (error) {
      onToast(error.response?.data?.message || 'Unable to load daily tasks.', 'error');
    } finally { setLoading(false); }
  }, [date, onToast]);

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

  if (compact) {
    const openCount = counts.missing + counts.in_progress;
    return (
      <div className="stat-grid stat-grid-2" style={{ marginBottom: '0.875rem' }}>
        <MetricCard
          label="Today's tasks"
          value={tasks.length}
          detail={openCount ? `${openCount} still open` : tasks.length ? 'All caught up' : 'No tasks assigned'}
          onClick={onOpenAll}
        />
        <MetricCard label="Missing" value={counts.missing} tone="danger" onClick={onOpenAll} />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Today's work"
        title="Daily tasks"
        subtitle="Mark each assignment in progress or completed. Missing tasks stay open until your supervisor excuses them."
      />
      <div className="stat-grid stat-grid-fill daily-task-metrics">
        <MetricCard label="Missing" value={counts.missing} tone="danger" />
        <MetricCard label="In progress" value={counts.in_progress} tone="warning" />
        <MetricCard label="Completed" value={counts.completed} tone="success" />
        <MetricCard label="Excused" value={counts.excused} />
      </div>
      <div className="card daily-task-toolbar">
        <label>
          <span>Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      {loading ? <SkeletonPage variant="list" label="Loading tasks" /> : tasks.length === 0 ? (
        <EmptyState title="No tasks for this date" sub="Your company supervisor will assign daily OJT work here." />
      ) : tasks.map((task) => (
        <article className="card daily-task-card" key={task.id}>
          <div className="daily-task-card-head">
            <div>
              <h3>{task.title}</h3>
              {task.description && <p>{task.description}</p>}
            </div>
            <StatusBadge tone={statusTone[task.status] || 'gray'}>{statusLabel(task.status)}</StatusBadge>
          </div>
          {task.excuse_remarks && <p className="daily-task-note">Excused: {task.excuse_remarks}</p>}
          {task.status !== 'excused' && task.status !== 'completed' && (
            <div className="daily-task-actions">
              {task.status === 'missing' && (
                <button type="button" className="action-btn action-btn-gray" disabled={savingId === task.id} onClick={() => updateStatus(task, 'in_progress')}>
                  Start task
                </button>
              )}
              <button type="button" className="action-btn action-btn-success" disabled={savingId === task.id} onClick={() => updateStatus(task, 'completed')}>
                {savingId === task.id ? 'Saving…' : 'Mark completed'}
              </button>
            </div>
          )}
        </article>
      ))}
    </>
  );
};

export default StudentDailyTasks;
