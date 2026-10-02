import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMyStudents } from '../../api/evaluations';
import { createDailyTask, deleteDailyTask, excuseDailyTask, getSupervisorDailyTasks } from '../../api/dailyTasks';
import EmptyState from './EmptyState';
import { StatusBadge } from './DashboardUI';
import DocViewerModal from './DocViewerModal';
import SecureImage from './SecureImage';
import SkeletonPage from './Skeleton';
import VectorIcon from './VectorIcon';

const todayInManila = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const shiftDate = (iso, days) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return todayInManila();
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

const statusTone = { missing: 'danger', in_progress: 'warning', completed: 'success', excused: 'gray' };
const statusLabel = (s) => s === 'missing' ? 'Absent' : String(s || 'missing').replace('_', ' ');
const isDone = (s) => s === 'completed' || s === 'excused';
const isOpen = (s) => s === 'missing' || s === 'in_progress';

const fmtShort = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtLong = (v) => {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
};
const initialsOf = (f, l) => `${f?.[0] || ''}${l?.[0] || ''}`.toUpperCase() || '•';

const SupervisorDailyTasks = ({ onToast = () => {} }) => {
  const [date, setDate] = useState(todayInManila);
  const [tasks, setTasks] = useState([]);
  const [counts, setCounts] = useState({ missing: 0, in_progress: 0, completed: 0, excused: 0 });
  const [availableDates, setAvailableDates] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', studentIds: [] });
  const [traineeSearch, setTraineeSearch] = useState('');
  const [tab, setTab] = useState('todo'); // todo | done | all
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [excuseTarget, setExcuseTarget] = useState(null);
  const [excuseRemarks, setExcuseRemarks] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [proofViewer, setProofViewer] = useState(null);
  const userPickedDate = useRef(false);
  const dateInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, studentRes] = await Promise.all([getSupervisorDailyTasks(date), getMyStudents()]);
      const nextTasks = taskRes.data.tasks || [];
      setTasks(nextTasks);
      setCounts(taskRes.data.counts || { missing: 0, in_progress: 0, completed: 0, excused: 0 });
      setAvailableDates(taskRes.data.availableDates || []);
      setStudents(studentRes.data.students || []);
      const ids = new Set(nextTasks.map((t) => t.template_id));
      setOpenId((cur) => (cur && ids.has(cur) ? cur : [...ids][0] || null));
      const nd = taskRes.data.availableDates || [];
      if (!userPickedDate.current && !nextTasks.length && nd[0] && nd[0] !== date) setDate(nd[0]);
    } catch (e) {
      onToast(e.response?.data?.message || 'Unable to load daily tasks.', 'error');
    } finally { setLoading(false); }
  }, [date, onToast]);

  useEffect(() => { load(); }, [load]);

  const allSelected = students.length > 0 && form.studentIds.length === students.length;

  const grouped = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      if (!map.has(t.template_id)) map.set(t.template_id, { ...t, assignments: [] });
      map.get(t.template_id).assignments.push(t);
    });
    return [...map.values()];
  }, [tasks]);

  const total = tasks.length;
  const done = counts.completed + counts.excused;
  const open = counts.missing + counts.in_progress;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const isToday = date === todayInManila();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return grouped
      .map((g) => {
        let a = g.assignments;
        if (tab === 'todo') a = a.filter((x) => isOpen(x.status));
        if (tab === 'done') a = a.filter((x) => isDone(x.status));
        if (q) {
          const hitTitle = `${g.title} ${g.description || ''}`.toLowerCase().includes(q);
          const hit = a.filter((x) => hitTitle || `${x.first_name} ${x.last_name}`.toLowerCase().includes(q));
          a = hitTitle && !hit.length ? a : hit;
        }
        return { ...g, assignments: a };
      })
      .filter((g) => g.assignments.length > 0)
      .sort((x, y) => {
        const xo = x.assignments.filter((a) => isOpen(a.status)).length;
        const yo = y.assignments.filter((a) => isOpen(a.status)).length;
        return yo - xo;
      });
  }, [grouped, tab, query]);

  const submitTask = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || saving) return;
    if (!form.studentIds.length) { onToast('Pick at least one trainee.', 'error'); return; }
    setSaving(true);
    try {
      const r = await createDailyTask({
        title: form.title.trim(), description: form.description.trim(),
        taskDate: date, studentIds: allSelected ? [] : form.studentIds,
      });
      onToast(r.data.message);
      setShowForm(false);
      setForm({ title: '', description: '', studentIds: [] });
      setTraineeSearch('');
      await load();
    } catch (e2) { onToast(e2.response?.data?.message || 'Unable to create the task.', 'error'); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || saving) return;
    setSaving(true);
    try {
      const r = await deleteDailyTask(deleteTarget.template_id);
      onToast(r.data.message);
      setDeleteTarget(null);
      await load();
    } catch (e) { onToast(e.response?.data?.message || 'Unable to delete this task.', 'error'); }
    finally { setSaving(false); }
  };

  const confirmExcuse = async () => {
    if (!excuseTarget || saving) return;
    setSaving(true);
    try {
      await excuseDailyTask(excuseTarget.id, { remarks: excuseRemarks.trim() });
      onToast(`${excuseTarget.first_name} ${excuseTarget.last_name} excused.`);
      setExcuseTarget(null); setExcuseRemarks('');
      await load();
    } catch (e) { onToast(e.response?.data?.message || 'Unable to excuse.', 'error'); }
    finally { setSaving(false); }
  };

  const toggleStudent = (id) => setForm((c) => {
    const s = new Set(c.studentIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    return { ...c, studentIds: [...s] };
  });

  const openForm = () => {
    setForm({ title: '', description: '', studentIds: students.map((s) => s.id) });
    setTraineeSearch('');
    setShowForm(true);
  };

  const formStudents = students.filter((s) => {
    const q = traineeSearch.trim().toLowerCase();
    return !q || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q);
  });

  const goDay = (d) => { userPickedDate.current = true; setDate(shiftDate(date, d)); };

  return (
    <div className="svt">
      {/* HERO — progress first, New task below it */}
      <section className="svt-hero" aria-label="Daily tasks summary">
        <div className="svt-hero-glow" aria-hidden="true" />
        <p className="svt-eyebrow"><VectorIcon name="clipboard" size={12} /> Daily tasks</p>
        <h1 className="svt-title">{open === 0 && total > 0 ? 'All caught up' : `${open} to follow up`}</h1>
        <p className="svt-sub">{total === 0 ? fmtLong(date) : `${done}/${total} done · ${fmtLong(date)}`}</p>
        {total > 0 && (
          <div className="svt-prow">
            <div className="svt-pbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks completed">
              <span style={{ width: `${pct}%` }} />
            </div>
            <strong>{pct}%</strong>
          </div>
        )}
        <button type="button" className="svt-new" onClick={openForm}>
          <VectorIcon name="plus" size={17} /> New task
        </button>
      </section>

      {/* DATE STEPPER — one-tap day navigation */}
      <div className="svt-days" role="group" aria-label="Change date">
        <button type="button" className="svt-day-nav" onClick={() => goDay(-1)} aria-label="Previous day">‹</button>
        <button type="button" className={`svt-day-main${isToday ? ' is-today' : ''}`} onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}>
          {isToday ? 'Today' : fmtShort(date)} · {fmtLong(date).split(',')[0]}
          <input ref={dateInputRef} type="date" value={date} aria-label="Pick a date"
            onChange={(e) => { if (e.target.value) { userPickedDate.current = true; setDate(e.target.value); } }} />
        </button>
        <button type="button" className="svt-day-nav" onClick={() => goDay(1)} aria-label="Next day">›</button>
      </div>

      {!loading && total > 0 && (
        <>
          <div className="svt-tabs" role="tablist" aria-label="Task filter">
            {[
              { v: 'todo', label: 'To do', count: open },
              { v: 'done', label: 'Done', count: done },
              { v: 'all', label: 'All', count: total },
            ].map((t) => (
              <button key={t.v} role="tab" aria-selected={tab === t.v} type="button"
                className={`svt-tab${tab === t.v ? ' is-on' : ''}`} onClick={() => setTab(t.v)}>
                {t.label}{t.count > 0 ? ` · ${t.count}` : ''}
              </button>
            ))}
          </div>
          <label className="svt-search">
            <VectorIcon name="search" size={15} />
            <input type="search" placeholder="Search task or name…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tasks" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear"><VectorIcon name="x" size={14} /></button>}
          </label>
        </>
      )}

      {/* LIST */}
      {loading ? <SkeletonPage variant="list" label="Loading tasks" />
        : grouped.length === 0 ? (
          <div className="svt-empty">
            <EmptyState title="No tasks for this date"
              sub={availableDates.length ? `Try ${availableDates.slice(0, 3).map(fmtShort).join(', ')}.` : 'Tap New task to assign work.'}
              action={openForm} actionLabel="New task" actionIcon="plus" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState title={tab === 'todo' ? 'Nothing to follow up' : 'Nothing here'} sub="Try another tab or search." />
        ) : visible.map((g) => {
          const totalA = g.assignments.length;
          const doneA = g.assignments.filter((a) => isDone(a.status)).length;
          const openA = totalA - doneA;
          const isOpened = openId === g.template_id;
          const stack = g.assignments.slice(0, 4);
          return (
            <article key={g.template_id} className={`svt-card${isOpened ? ' is-open' : ''}${openA > 0 ? ' needs' : ' calm'}`}>
              <button type="button" className="svt-card-head" onClick={() => setOpenId(isOpened ? null : g.template_id)}
                aria-expanded={isOpened} aria-label={`${g.title}, ${openA} open`}>
                <span className="svt-rail" aria-hidden="true" />
                <span className="svt-head-copy">
                  <strong>{g.title}</strong>
                  {g.description && <small>{g.description}</small>}
                  <span className="svt-meta">
                    <span className="svt-avatars" aria-hidden="true">
                      {stack.map((a) => <i key={a.id}>{initialsOf(a.first_name, a.last_name)}</i>)}
                      {totalA > 4 && <i className="more">+{totalA - 4}</i>}
                    </span>
                    <span className="svt-frac">{doneA}/{totalA} done</span>
                    {openA > 0 && <span className="svt-need">{openA} need you</span>}
                  </span>
                  <span className="svt-bar"><span style={{ width: `${totalA ? Math.round((doneA / totalA) * 100) : 0}%` }} /></span>
                </span>
                <VectorIcon name="chevronRight" size={17} className="svt-chev" />
              </button>

              {isOpened && (
                <div className="svt-body">
                  {g.assignments.map((a) => (
                    <div className="svt-row" key={a.id}>
                      <span className={`svt-dot is-${a.status}`} aria-hidden="true" />
                      <span className="svt-ava" aria-hidden="true">{initialsOf(a.first_name, a.last_name)}</span>
                      <div className="svt-who">
                        <strong>{a.first_name} {a.last_name}</strong>
                        <small>{a.excuse_remarks ? `Excused · ${a.excuse_remarks}` : a.student_notes ? `“${a.student_notes}”` : statusLabel(a.status)}</small>
                        {a.excuse_requested_at && a.status !== 'excused' && (
                          <small className="svt-excuse-req">Excuse requested{a.excuse_request_remarks ? ` · ${a.excuse_request_remarks}` : ''}</small>
                        )}
                        {a.proof_image_url && (a.status === 'completed' || a.status === 'excused') && (
                          <button
                            type="button"
                            className="svt-proof-submitted"
                            onClick={() => setProofViewer({ url: a.proof_image_url, name: `${g.title} · ${a.first_name} ${a.last_name}` })}
                          >
                            <SecureImage src={a.proof_image_url} alt="" />
                            <span>Submitted photo · tap to view</span>
                          </button>
                        )}
                        {a.proof_image_url && a.status !== 'completed' && a.status !== 'excused' && (
                          <button
                            type="button"
                            className="svt-proof"
                            onClick={() => setProofViewer({ url: a.proof_image_url, name: `${g.title} · ${a.first_name} ${a.last_name}` })}
                          >
                            <SecureImage src={a.proof_image_url} alt="" />
                            <span>View photo</span>
                          </button>
                        )}
                      </div>
                      <StatusBadge tone={statusTone[a.status] || 'gray'}>{statusLabel(a.status)}</StatusBadge>
                      {isOpen(a.status)
                        ? <button type="button" className="svt-excuse" onClick={() => { setExcuseTarget(a); setExcuseRemarks(''); }}>Excuse</button>
                        : <span className="svt-ok"><VectorIcon name="check" size={14} /></span>}
                    </div>
                  ))}
                  <div className="svt-foot">
                    <span>{fmtLong(g.task_date || date)}</span>
                    <button type="button" className="svt-del" onClick={() => setDeleteTarget(g)} aria-label={`Delete ${g.title}`}>
                      <VectorIcon name="trash" size={13} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}

      {/* NEW TASK SHEET */}
      {showForm && (
        <div className="modal-overlay" onClick={() => !saving && setShowForm(false)}>
          <form className="modal-content svt-sheet" onSubmit={submitTask} onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 className="modal-title">New task</h2>
            <p className="svt-sheet-sub">{fmtLong(date)} · {form.studentIds.length}/{students.length} trainees</p>
            <div className="form-group">
              <label htmlFor="svt-title">Task</label>
              <input id="svt-title" required autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Submit today’s work log" />
            </div>
            <div className="form-group">
              <label htmlFor="svt-desc">Details <em>optional</em></label>
              <textarea id="svt-desc" rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What should they finish?" />
            </div>
            <div className="svt-pickbar">
              <span>Who?</span>
              <button type="button" onClick={() => setForm((c) => ({ ...c, studentIds: students.map((s) => s.id) }))}>All</button>
              <button type="button" onClick={() => setForm((c) => ({ ...c, studentIds: [] }))}>None</button>
            </div>
            <label className="svt-search is-mini">
              <VectorIcon name="search" size={14} />
              <input type="search" placeholder="Find trainee…" value={traineeSearch} onChange={(e) => setTraineeSearch(e.target.value)} aria-label="Find trainee" />
            </label>
            <div className="svt-picks">
              {formStudents.map((s) => {
                const on = form.studentIds.includes(s.id);
                return (
                  <button type="button" key={s.id} className={`svt-pick${on ? ' is-on' : ''}`} onClick={() => toggleStudent(s.id)} aria-pressed={on}>
                    <span className="svt-ava is-sm">{initialsOf(s.first_name, s.last_name)}</span>
                    {s.first_name} {s.last_name}
                    <span className="svt-tick"><VectorIcon name="check" size={12} /></span>
                  </button>
                );
              })}
              {!formStudents.length && <p className="svt-muted">No trainees found.</p>}
            </div>
            <div className="modal-actions grid-2">
              <button type="button" className="action-btn action-btn-gray" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
              <button type="submit" className="action-btn action-btn-primary" disabled={saving || !form.title.trim() || !form.studentIds.length}>
                {saving ? 'Assigning…' : `Assign · ${form.studentIds.length}`}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !saving && setDeleteTarget(null)}>
          <div className="modal-content svt-sheet is-narrow" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 className="modal-title">Delete “{deleteTarget.title}”?</h2>
            <p className="svt-sheet-sub">Removes it for {deleteTarget.assignments.length} trainee{deleteTarget.assignments.length === 1 ? '' : 's'}. Can’t be undone.</p>
            <div className="modal-actions grid-2">
              <button type="button" className="action-btn action-btn-gray" onClick={() => setDeleteTarget(null)} disabled={saving}>Keep</button>
              <button type="button" className="action-btn action-btn-danger" onClick={confirmDelete} disabled={saving}>{saving ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {proofViewer && (
        <DocViewerModal file={proofViewer} onClose={() => setProofViewer(null)} />
      )}

      {excuseTarget && (
        <div className="modal-overlay" onClick={() => !saving && setExcuseTarget(null)}>
          <div className="modal-content svt-sheet is-narrow" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 className="modal-title">Excuse {excuseTarget.first_name}?</h2>
            <p className="svt-sheet-sub">Skips “{excuseTarget.title}” for them.</p>
            <div className="form-group">
              <label htmlFor="svt-excuse">Note <em>optional</em></label>
              <input id="svt-excuse" value={excuseRemarks} onChange={(e) => setExcuseRemarks(e.target.value)} placeholder="Reason…" />
            </div>
            <div className="modal-actions grid-2">
              <button type="button" className="action-btn action-btn-gray" onClick={() => setExcuseTarget(null)} disabled={saving}>Cancel</button>
              <button type="button" className="action-btn action-btn-primary" onClick={confirmExcuse} disabled={saving}>{saving ? 'Saving…' : 'Excuse'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupervisorDailyTasks;
