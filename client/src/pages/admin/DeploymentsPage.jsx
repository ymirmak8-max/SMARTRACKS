import { useState, useEffect, useCallback } from 'react';
import { getDeployments, createDeployment, updateDeployment, getCompanies, getDeploymentOptions } from '../../api/deployments';
import useAuth from '../../hooks/useAuth';
import EmptyState from '../../components/common/EmptyState';
import DocPreview from '../../components/common/DocPreview';
import DocViewerModal from '../../components/common/DocViewerModal';
import SkeletonPage from '../../components/common/Skeleton';

const EMPTY_FORM = {
  studentId: '', supervisorId: '', coordinatorId: '',
  companyId: '', primaryLocationId: '', locationIds: [], requiredHours: 486, startDate: '', endDate: '',
  workDays: [1, 2, 3, 4, 5], workStartTime: '08:00', workEndTime: '17:00', lateGraceMinutes: 15,
};

const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

const scheduleLabel = (deployment) => {
  const days = WEEKDAYS.filter(day => (deployment.work_days || [1, 2, 3, 4, 5]).includes(day.value)).map(day => day.label);
  const dayText = days.join(', ') === 'Mon, Tue, Wed, Thu, Fri' ? 'Mon–Fri' : days.join(', ');
  return `${dayText} · ${String(deployment.work_start_time || '08:00').slice(0, 5)}–${String(deployment.work_end_time || '17:00').slice(0, 5)}`;
};

const todayStatus = (deployment) => {
  if (deployment.status !== 'active') return { label: deployment.status === 'completed' ? 'Completed' : 'Cancelled', tone: 'badge-gray' };
  if (deployment.today_clock_in && !deployment.today_clock_out) return { label: 'Timed in', tone: 'badge-success' };
  if (deployment.today_clock_out) return { label: 'Timed out', tone: 'badge-primary' };
  return { label: 'Not timed in', tone: 'badge-gray' };
};

const DeploymentsPage = ({ onBack: _onBack, onViewStudent = null, showHeader = true, prefillStudentId = '', onPrefillConsumed = null, searchQuery = null, hideSearch = false, progressByStudent = null, createSignal = 0, studentExtras = null, detailFetcher = null }) => {
  const { user } = useAuth();
  const isCoordinator = user?.role === 'coordinator';
  const [deployments, setDeployments] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [students, setStudents] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [coordinators, setCoordinators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [detailsCache, setDetailsCache] = useState({});
  const [detailLoadingId, setDetailLoadingId] = useState(null);
  const [docViewer, setDocViewer] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const openDoc = (doc) => {
    if (doc?.file_url) setDocViewer({ url: doc.file_url, name: doc.requirement_name || 'Document' });
  };

  const toggleExpand = (deployment) => {
    const opening = expandedId !== deployment.id;
    setExpandedId(opening ? deployment.id : null);
    if (opening && detailFetcher && !detailsCache[deployment.student_id]) {
      setDetailLoadingId(deployment.student_id);
      detailFetcher(deployment.student_id)
        .then(data => setDetailsCache(current => ({ ...current, [deployment.student_id]: data })))
        .catch(() => {})
        .finally(() => setDetailLoadingId(current => (current === deployment.student_id ? null : current)));
    }
  };

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(''), 6000); }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [depResult, companyResult, optionsResult] = await Promise.allSettled([
        getDeployments(), getCompanies(), getDeploymentOptions(),
      ]);
      if (depResult.status === 'fulfilled') {
        setDeployments(depResult.value.data.deployments);
      } else {
        setDeployments([]);
        showToast('Failed to load deployments.');
      }
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value.data.companies : []);
      const users = optionsResult.status === 'fulfilled' ? optionsResult.value.data.users : [];
      setStudents(users.filter(u => u.role === 'student'));
      setSupervisors(users.filter(u => u.role === 'supervisor'));
      setCoordinators(users.filter(u => u.role === 'coordinator'));
      if (companyResult.status === 'rejected' || optionsResult.status === 'rejected') {
        showToast('Some deployment form options are temporarily unavailable.');
      }
    } catch { showToast('Failed to load deployment data.'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (searchQuery == null) return;
    setSearch(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (!prefillStudentId) return;
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, studentId: prefillStudentId });
    setFormError('');
    setShowAdvanced(false);
    setShowModal(true);
    onPrefillConsumed?.();
  }, [prefillStudentId, onPrefillConsumed]);

  useEffect(() => {
    if (!createSignal) return;
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowAdvanced(false);
    setShowModal(true);
  }, [createSignal]);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormError(''); setShowAdvanced(false); setShowModal(true); };
  const openEdit = (d) => {
    setEditTarget(d);
    setForm({
      studentId: d.student_id, supervisorId: d.supervisor_id || '',
      coordinatorId: d.coordinator_id || '', companyId: d.company_id,
      primaryLocationId: d.primary_location_id || '',
      locationIds: (d.assigned_locations || []).map(location => location.id),
      requiredHours: d.required_hours,
      startDate: d.start_date ? d.start_date.split('T')[0] : '',
      endDate: d.end_date ? d.end_date.split('T')[0] : '',
      workDays: d.work_days || [1, 2, 3, 4, 5],
      workStartTime: String(d.work_start_time || '08:00').slice(0, 5),
      workEndTime: String(d.work_end_time || '17:00').slice(0, 5),
      lateGraceMinutes: d.late_grace_minutes ?? 15,
      status: d.status || 'active',
    });
    setFormError(''); setShowAdvanced(true); setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setFormError(''); setFormLoading(true);
    try {
      if (editTarget) { await updateDeployment(editTarget.id, form); showToast('Deployment updated.'); }
      else { await createDeployment(form); showToast('Deployment created.'); }
      setShowModal(false); fetchAll();
    } catch (err) { setFormError(err.response?.data?.message || 'Something went wrong.'); }
    finally { setFormLoading(false); }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const visibleDeployments = deployments.filter(deployment => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [
      deployment.student_id,
      deployment.student_first,
      deployment.student_last,
      `${deployment.student_first || ''} ${deployment.student_last || ''}`,
      deployment.student_email,
      deployment.company_name,
      deployment.supervisor_first,
      deployment.supervisor_last,
    ].some(value => String(value || '').toLowerCase().includes(query));
    const matchesStatus = statusFilter === 'all' || deployment.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const selectedCompany = companies.find(company => company.id === form.companyId);
  const availableLocations = selectedCompany?.locations || [];

  return (
    <div className="dep-list">
      {/* Header */}
      {showHeader && <div className="dep-panel-head">
        <div>
          <div className="section-title">Deployments</div>
          <div className="section-sub">Link students to companies</div>
        </div>
        <button onClick={openCreate} className="dep-go">+ Deploy</button>
      </div>}

      <div className="dep-tools" role="search" aria-label="Filter deployments">
        {!hideSearch && (
          <label className="dep-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search deployments…"
              aria-label="Search deployments"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">×</button>
            )}
          </label>
        )}
        <div className="dep-pills" role="group" aria-label="Filter by deployment status">
          {[
            { v: 'all', label: 'All' },
            { v: 'active', label: 'Active' },
            { v: 'completed', label: 'Done' },
            { v: 'cancelled', label: 'Off' },
          ].map(option => (
            <button
              key={option.v}
              type="button"
              className={`dep-pill${statusFilter === option.v ? ' is-on' : ''}`}
              aria-pressed={statusFilter === option.v}
              onClick={() => setStatusFilter(option.v)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Deployments as Cards on mobile */}
      {loading ? (
        <SkeletonPage variant="list" label="Loading deployments" />
      ) : visibleDeployments.length === 0 ? (
        <div className="card"><EmptyState
          type="deployments"
          title={deployments.length ? 'No matching deployments' : 'No deployments yet'}
          sub={deployments.length ? 'Change or clear the search and status filters.' : 'Deploy a student to a company to get started.'}
          action={deployments.length ? () => { setSearch(''); setStatusFilter('all'); } : openCreate}
          actionLabel={deployments.length ? 'Clear filters' : 'Create deployment'}
        /></div>
      ) : (
        <div className="deployment-grid">
          {visibleDeployments.map(d => {
            const today = todayStatus(d);
            const progress = progressByStudent?.[String(d.student_id)];
            const expanded = expandedId === d.id;
            const supervisor = d.supervisor_first ? `${d.supervisor_first} ${d.supervisor_last}` : 'No supervisor';
            const extra = Array.isArray(studentExtras)
              ? studentExtras.find(item => String(item.id) === String(d.student_id))
              : null;
            const detail = detailsCache[d.student_id] || null;
            const loadingDetail = detailLoadingId === d.student_id;
            const docTone = (status) => status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'gray';
            return (
              <article key={d.id} className="card deployment-card dep-row">
                <button
                  type="button"
                  className="dep-row-head"
                  aria-expanded={expanded}
                  onClick={() => toggleExpand(d)}
                  aria-label={`${d.student_first} ${d.student_last}, ${today.label}`}
                >
                  <span className="deployment-card-avatar" aria-hidden="true">
                    {`${d.student_first?.[0] || ''}${d.student_last?.[0] || ''}`.toUpperCase()}
                  </span>
                  <span className="deployment-card-name">
                    <strong>{d.student_first} {d.student_last}</strong>
                    <small>{d.company_name || 'No company'} · {supervisor}</small>
                  </span>
                  <span className={`badge ${today.tone}`}>{today.label}</span>
                  <span className={`dep-chev${expanded ? ' is-open' : ''}`} aria-hidden="true">›</span>
                </button>

                {progress && (
                  <div className="deployment-card-progress dep-top-progress" aria-label={`${Math.round(progress.percent)} percent of required hours`}>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress.percent}%` }} /></div>
                    <span><strong>{Math.round(progress.percent)}%</strong> · {Math.round(progress.rendered)} / {progress.required || d.required_hours} h</span>
                  </div>
                )}

                {expanded && (
                  <>
                    <dl className="deployment-card-details">
                      <div><dt>Worksite</dt><dd>{d.primary_location_name || 'Main worksite'}</dd></div>
                      <div><dt>Schedule</dt><dd>{scheduleLabel(d)}</dd></div>
                      <div><dt>Period</dt><dd>{d.start_date || d.end_date ? `${formatDate(d.start_date)} – ${formatDate(d.end_date)}` : 'Not set'}</dd></div>
                      <div><dt>Required</dt><dd>{d.required_hours} h</dd></div>
                      <div><dt>Email</dt><dd>{d.student_email}</dd></div>
                      {!isCoordinator && <div><dt>Coordinator</dt><dd>{d.coordinator_first ? `${d.coordinator_first} ${d.coordinator_last}` : '—'}</dd></div>}
                    </dl>
                    <p className="dep-mini-label">Documents</p>
                    {loadingDetail ? (
                      <p className="dep-empty">Loading details…</p>
                    ) : detail && Array.isArray(detail.documents) && detail.documents.length > 0 ? (
                      <div className="dep-docs">
                        {detail.documents.map(doc => (
                          <div className="dep-doc" key={doc.id}>
                            {doc.file_url && <DocPreview url={doc.file_url} name={doc.requirement_name} onOpen={() => openDoc(doc)} />}
                            <span className="dep-doc-name">{doc.requirement_name}</span>
                            <span className="dep-doc-side">
                              <span className={`badge badge-${docTone(doc.status)}`}>{doc.status}</span>
                              {doc.file_url && (
                                <button type="button" className="dep-link" onClick={() => openDoc(doc)}>View</button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : extra ? (
                      <p className="dep-extra-docs">
                        <strong>{extra.approved_documents ?? 0}/{extra.total_requirements ?? 0} approved</strong>
                        {Number(extra.pending_documents) > 0 && <em> · {extra.pending_documents} pending</em>}
                      </p>
                    ) : null}
                    <p className="dep-mini-label">Evaluations</p>
                    {loadingDetail ? null : detail && Array.isArray(detail.evaluations) && detail.evaluations.length > 0 ? (
                      <div className="dep-evals">
                        {detail.evaluations.map(ev => (
                          <div className="dep-eval" key={ev.id}>
                            <div className="dep-eval-head">
                              <strong style={{ textTransform: 'capitalize' }}>{ev.period}</strong>
                              <span>{ev.total_score}</span>
                            </div>
                            {ev.comments && <p>“{ev.comments}”</p>}
                          </div>
                        ))}
                      </div>
                    ) : detailFetcher && !loadingDetail ? (
                      <p className="dep-empty">No evaluations yet.</p>
                    ) : null}
                    <div className="deployment-card-actions">
                      {onViewStudent && (
                        <button type="button" onClick={() => onViewStudent(d.student_id)} className="dep-link">Attendance</button>
                      )}
                      <button type="button" onClick={() => openEdit(d)} className="dep-go is-sm">Edit</button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Deployment Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !formLoading && setShowModal(false)}>
          <div className="modal-content dep-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">{editTarget ? 'Edit deployment' : 'New deployment'}</div>
            <p className="dep-sheet-sub">
              {editTarget
                ? `${editTarget.student_first} ${editTarget.student_last} · ${editTarget.company_name || ''}`
                : 'Link a trainee to a company in three quick steps.'}
            </p>
            <form onSubmit={handleSubmit}>
              <p className="dep-group-label">Who</p>
              {!editTarget && (
                <div className="form-group">
                  <label>Student *</label>
                  <select value={form.studentId} onChange={e => setForm({ ...form, studentId: e.target.value })} required>
                    <option value="">Select student...</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>Supervisor *</label>
                <select value={form.supervisorId} onChange={e => setForm({ ...form, supervisorId: e.target.value })} required>
                  <option value="">Select supervisor...</option>
                  {supervisors.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
                </select>
              </div>
              {!isCoordinator && <div className="form-group">
                <label>Coordinator</label>
                <select value={form.coordinatorId} onChange={e => setForm({ ...form, coordinatorId: e.target.value })}>
                  <option value="">Select coordinator...</option>
                  {coordinators.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
                </select>
              </div>}
              <p className="dep-group-label">Where</p>
              <div className="form-group">
                <label>Company *</label>
                <select value={form.companyId} onChange={e => {
                  const company = companies.find(item => item.id === e.target.value);
                  const primary = company?.locations?.find(location => location.is_primary) || company?.locations?.[0];
                  setForm({ ...form, companyId: e.target.value, primaryLocationId: primary?.id || '',
                    locationIds: primary ? [primary.id] : [] });
                }} required>
                  <option value="">Select company...</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Primary Worksite *</label>
                <select value={form.primaryLocationId} onChange={e => {
                  const id = e.target.value;
                  setForm({ ...form, primaryLocationId: id,
                    locationIds: [...new Set([id, ...form.locationIds].filter(Boolean))] });
                }} required disabled={!form.companyId}>
                  <option value="">{form.companyId ? 'Select worksite...' : 'Select a company first'}</option>
                  {availableLocations.map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name} · {location.attendance_mode === 'fixed' ? `${location.geo_radius_meters}m geofence` : location.attendance_mode}
                    </option>
                  ))}
                </select>
              </div>
              {availableLocations.length > 1 && (
                <fieldset className="form-group dep-checks">
                  <legend>Other approved worksites</legend>
                  {availableLocations.filter(location => location.id !== form.primaryLocationId).map(location => (
                    <label key={location.id}>
                      <input type="checkbox" checked={form.locationIds.includes(location.id)}
                        onChange={event => setForm({ ...form, locationIds: event.target.checked
                          ? [...new Set([...form.locationIds, location.id])]
                          : form.locationIds.filter(id => id !== location.id) })} />
                      {location.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <button
                type="button"
                className="dep-advanced-toggle"
                aria-expanded={showAdvanced}
                onClick={() => setShowAdvanced(value => !value)}
              >
                <span>Schedule & defaults</span>
                <em>optional</em>
                <i className={showAdvanced ? 'is-open' : ''} aria-hidden="true">›</i>
              </button>
              {showAdvanced && (
              <>
              <div className="form-group">
                <label>Required Hours</label>
                <input type="number" value={form.requiredHours}
                  onChange={e => setForm({ ...form, requiredHours: e.target.value })} />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label>Start Date</label>
                  <input type="date" value={form.startDate}
                    onChange={e => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>End Date</label>
                  <input type="date" value={form.endDate}
                    onChange={e => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Workdays *</label>
                <div className="dep-days">
                  {WEEKDAYS.map(day => {
                    const selected = form.workDays.includes(day.value);
                    return (
                      <button key={day.value} type="button"
                        className={`dep-day${selected ? ' is-on' : ''}`}
                        aria-pressed={selected}
                        onClick={() => setForm({
                          ...form,
                          workDays: selected ? form.workDays.filter(value => value !== day.value) : [...form.workDays, day.value],
                        })}>{day.label}</button>
                    );
                  })}
                </div>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label>Shift Start *</label>
                  <input type="time" value={form.workStartTime} required
                    onChange={e => setForm({ ...form, workStartTime: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Shift End *</label>
                  <input type="time" value={form.workEndTime} required
                    onChange={e => setForm({ ...form, workEndTime: e.target.value })} />
                </div>
              </div>
              <div className="form-group">
                <label>Late grace (minutes)</label>
                <input type="number" min="0" max="180" value={form.lateGraceMinutes}
                  onChange={e => setForm({ ...form, lateGraceMinutes: e.target.value })} />
              </div>
              {editTarget && (
                <div className="form-group">
                  <label>Status</label>
                  <select value={form.status || 'active'} onChange={e => setForm({ ...form, status: e.target.value })}>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              )}
              </>
              )}
              {formError && <p className="error-message">{formError}</p>}
              <div className="modal-actions grid-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="action-btn action-btn-gray" disabled={formLoading}>Cancel</button>
                <button type="submit" disabled={formLoading} className="action-btn action-btn-primary">
                  {formLoading ? 'Saving…' : editTarget ? 'Save' : 'Deploy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {docViewer && (
        <DocViewerModal file={docViewer} onClose={() => setDocViewer(null)} />
      )}

      {toast && (
        <div className="toast">{toast}</div>
      )}
    </div>
  );
};

export default DeploymentsPage;
