import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMyStudents } from '../../api/evaluations';
import { createDailyTask, excuseDailyTask, getSupervisorDailyTasks } from '../../api/dailyTasks';
import EmptyState from './EmptyState';
import { MetricCard, PageHeader, StatusBadge } from './DashboardUI';
import SkeletonPage from './Skeleton';
import VectorIcon from './VectorIcon';

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

const SupervisorDailyTasks = ({ onToast = () => {} }) => {
  const [date, setDate] = useState(todayInManila);
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ missing: 0, in_progress: 0, completed: 0, excused: 0 });
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', studentIds: [] });
  const [excuseTarget, setExcuseTarget] = useState(null);
  const [excuseRemarks, setExcuseRemarks] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, studentRes] = await Promise.all([
        getSupervisorDailyTasks(date),
        getMyStudents(),
      ]);
      setTasks(taskRes.data.tasks || []);
      setCounts(taskRes.data.counts || { missing: 0, in_progress: 0, completed: 0, excused: 0 });
      setStudents(studentRes.data.students || []);
    } catch (error) {
      onToast(error.response?.data?.message || 'Unable to load daily tasks.', 'error');
    } finally { setLoading(false); }
  }, [date, onToast]);

  useEffect(() => { load(); }, [load]);

  const allSelected = form.studentIds.length === 0 || form.studentIds.length === students.length;

  const grouped = useMemo(() => {
    const map = new Map();
    tasks.forEach((task) => {
      const key = task.template_id;
      if (!map.has(key)) map.set(key, { ...task, assignments: [] });
      map.get(key).assignments.push(task);
    });
    return [...map.values()];
  }, [tasks]);

  const submitTask = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try {
      const response = await createDailyTask({
        title: form.title.trim(),
        description: form.description.trim(),
        taskDate: date,
        studentIds: allSelected ? [] : form.studentIds,
      });
      onToast(response.data.message);
      setShowForm(false);
      setForm({ title: '', description: '', studentIds: [] });
      await load();
    } catch (error) {
      onToast(error.response?.data?.message || 'Unable to create the task.', 'error');
    } finally { setSaving(false); }
  };

  const confirmExcuse = async () => {
    if (!excuseTarget || saving) return;
    setSaving(true);
    try {
      await excuseDailyTask(excuseTarget.id, { remarks: excuseRemarks.trim() });
      onToast(`${excuseTarget.first_name} ${excuseTarget.last_name} was marked excused.`);
      setExcuseTarget(null);
      setExcuseRemarks('');
      await load();
    } catch (error) {
      onToast(error.response?.data?.message || 'Unable to excuse this task.', 'error');
    } finally { setSaving(false); }
  };

  const toggleStudent = (id) => {
    setForm((current) => {
      const selected = new Set(current.studentIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...current, studentIds: [...selected] };
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="OJT follow-up"
        title="Daily tasks"
        subtitle="Assign work for today, then track missing, in progress, completed, or excused items."
        actions={(
            <button type="button" className="btn-compact-primary icon-label" onClick={() => {
            setForm({ title: '', description: '', studentIds: students.map((student) => student.id) });
            setShowForm(true);
          }}>
            <VectorIcon name="plus" size={16} /> New task
          </button>
        )}
      />

      <div className="stat-grid stat-grid-fill daily-task-metrics">
        <MetricCard label="Missing" value={counts.missing} tone="danger" />
        <MetricCard label="In progress" value={counts.in_progress} tone="warning" />
        <MetricCard label="Completed" value={counts.completed} tone="success" />
        <MetricCard label="Excused" value={counts.excused} />
      </div>

      <div className="card daily-task-toolbar">
        <label>
          <span>Task date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>

      {loading ? <SkeletonPage variant="list" label="Loading tasks" /> : grouped.length === 0 ? (
        <EmptyState title="No tasks for this date" sub="Create a daily task and assign it to your OJT trainees." />
      ) : grouped.map((group) => (
        <article className="card daily-task-group" key={group.template_id}>
          <header>
            <h3>{group.title}</h3>
            {group.description && <p>{group.description}</p>}
          </header>
          <div className="daily-task-assignment-list">
            {group.assignments.map((assignment) => (
              <div className="daily-task-assignment" key={assignment.id}>
                <div>
                  <strong>{assignment.first_name} {assignment.last_name}</strong>
                  <span>{assignment.email}</span>
                  {assignment.excuse_remarks && <em>Excuse: {assignment.excuse_remarks}</em>}
                  {assignment.student_notes && <em>Trainee note: {assignment.student_notes}</em>}
                </div>
                <StatusBadge tone={statusTone[assignment.status] || 'gray'}>{statusLabel(assignment.status)}</StatusBadge>
                {['missing', 'in_progress'].includes(assignment.status) && (
                  <button
                    type="button"
                    className="action-btn action-btn-gray"
                    onClick={() => { setExcuseTarget(assignment); setExcuseRemarks(''); }}
                  >
                    Mark excused
                  </button>
                )}
              </div>
            ))}
          </div>
        </article>
      ))}

      {showForm && (
        <div className="modal-overlay">
          <form className="modal-content daily-task-form" onSubmit={submitTask}>
            <div className="modal-handle" />
            <h2 className="modal-title">New daily task</h2>
            <p>Assigned for {date}. Leave trainees unchecked to include everyone assigned to you.</p>
            <div className="form-group">
              <label htmlFor="daily-task-title">Title</label>
              <input id="daily-task-title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Submit today’s work log" />
            </div>
            <div className="form-group">
              <label htmlFor="daily-task-description">Details (optional)</label>
              <textarea id="daily-task-description" rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What should the trainee finish today?" />
            </div>
            <fieldset className="daily-task-students">
              <legend>Assign to</legend>
              {students.length === 0 ? <p>No assigned trainees yet.</p> : students.map((student) => (
                <label key={student.id}>
                  <input
                    type="checkbox"
                    checked={form.studentIds.includes(student.id)}
                    onChange={() => toggleStudent(student.id)}
                  />
                  {student.first_name} {student.last_name}
                </label>
              ))}
            </fieldset>
            <div className="modal-actions grid-2">
              <button type="button" className="action-btn action-btn-gray" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button type="submit" className="action-btn action-btn-primary" disabled={saving || !form.studentIds.length}>{saving ? 'Assigning…' : 'Assign task'}</button>
            </div>
          </form>
        </div>
      )}

      {excuseTarget && (
        <div className="modal-overlay">
          <div className="modal-content daily-task-form" role="dialog" aria-modal="true">
            <div className="modal-handle" />
            <h2 className="modal-title">Mark this task excused?</h2>
            <p>{excuseTarget.first_name} {excuseTarget.last_name} will not need to complete “{excuseTarget.title}”.</p>
            <div className="form-group">
              <label htmlFor="daily-task-excuse">Excuse note (optional)</label>
              <input id="daily-task-excuse" value={excuseRemarks} onChange={(event) => setExcuseRemarks(event.target.value)} placeholder="Reason for the excuse" />
            </div>
            <div className="modal-actions grid-2">
              <button type="button" className="action-btn action-btn-gray" onClick={() => !saving && setExcuseTarget(null)} disabled={saving}>Cancel</button>
              <button type="button" className="action-btn action-btn-primary" onClick={confirmExcuse} disabled={saving}>{saving ? 'Saving…' : 'Mark excused'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SupervisorDailyTasks;
