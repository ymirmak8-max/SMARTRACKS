import { useState, useEffect, useCallback } from 'react';
import { getDeployments, createDeployment, updateDeployment, getCompanies, getDeploymentOptions } from '../../api/deployments';
import useAuth from '../../hooks/useAuth';
import EmptyState from '../../components/common/EmptyState';
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

const DeploymentsPage = ({ onBack: _onBack, onViewStudent = null, showHeader = true, prefillStudentId = '', onPrefillConsumed = null, searchQuery = null, hideSearch = false }) => {
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
    setShowModal(true);
    onPrefillConsumed?.();
  }, [prefillStudentId, onPrefillConsumed]);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true); };
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
    });
    setFormError(''); setShowModal(true);
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
    <div>
      {/* Header */}
      {showHeader && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '0.5rem' }}>
        <div>
          <div className="section-title">Deployments</div>
          <div className="section-sub">Link students to companies</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          <button onClick={openCreate} className="btn-compact-primary">+ Deploy</button>
        </div>
      </div>}

      <div className="deployment-toolbar" role="search" aria-label="Filter deployments">
        {!hideSearch && (
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search by student name, ID, email, company, or supervisor"
            aria-label="Search deployments"
          />
        )}
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter by deployment status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {visibleDeployments.map(d => (
            <div key={d.id} className="card" style={{ padding: '1rem' }}>
              {/* Student */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{d.student_first} {d.student_last}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{d.student_email}</div>
                </div>
                <span className={`badge ${d.status === 'active' ? 'badge-success' : 'badge-gray'}`} style={{ textTransform: 'capitalize', flexShrink: 0 }}>
                  {d.status}
                </span>
              </div>

              {/* Details */}
              <div className="mobile-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                {[
                  { label: 'Company', value: d.company_name || '—' },
                  { label: 'Primary worksite', value: d.primary_location_name || 'Main Worksite' },
                  { label: 'Hours', value: `${d.required_hours}h` },
                  { label: 'Supervisor', value: d.supervisor_first ? `${d.supervisor_first} ${d.supervisor_last}` : '—' },
                  { label: 'Coordinator', value: d.coordinator_first ? `${d.coordinator_first} ${d.coordinator_last}` : '—' },
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 500, marginTop: '0.1rem' }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Period */}
              {(d.start_date || d.end_date) && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginBottom: '0.75rem' }}>
                  {formatDate(d.start_date)} — {formatDate(d.end_date)}
                </div>
              )}
              <div style={{ fontSize: '0.76rem', color: 'var(--text-2)', marginBottom: '0.75rem', padding: '0.55rem 0.7rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)' }}>
                <strong>Schedule:</strong>{' '}
                {WEEKDAYS.filter(day => (d.work_days || [1, 2, 3, 4, 5]).includes(day.value)).map(day => day.label).join(', ')} ·{' '}
                {String(d.work_start_time || '08:00').slice(0, 5)}–{String(d.work_end_time || '17:00').slice(0, 5)} ·{' '}
                {d.late_grace_minutes ?? 15} min grace
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                {onViewStudent && (
                  <button onClick={() => onViewStudent(d.student_id)} className="action-btn action-btn-gray" style={{ padding: '0.4rem 0.875rem' }}>
                    View record
                  </button>
                )}
                <button onClick={() => openEdit(d)} className="action-btn action-btn-primary" style={{ padding: '0.4rem 0.875rem' }}>
                  Edit deployment
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deployment Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-handle" />
            <div className="modal-title">{editTarget ? 'Edit Deployment' : 'New Deployment'}</div>
            <form onSubmit={handleSubmit}>
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
                <fieldset className="form-group" style={{ border: 0, padding: 0 }}>
                  <legend style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>Other approved worksites</legend>
                  <div style={{ display: 'grid', gap: '0.45rem' }}>
                    {availableLocations.filter(location => location.id !== form.primaryLocationId).map(location => (
                      <label key={location.id} className="icon-label" style={{ fontWeight: 400 }}>
                        <input type="checkbox" checked={form.locationIds.includes(location.id)}
                          onChange={event => setForm({ ...form, locationIds: event.target.checked
                            ? [...new Set([...form.locationIds, location.id])]
                            : form.locationIds.filter(id => id !== location.id) })} />
                        {location.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
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
                <label>Scheduled Workdays *</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.35rem' }}>
                  {WEEKDAYS.map(day => {
                    const selected = form.workDays.includes(day.value);
                    return (
                      <button key={day.value} type="button" onClick={() => setForm({
                        ...form,
                        workDays: selected ? form.workDays.filter(value => value !== day.value) : [...form.workDays, day.value],
                      })} style={{
                        padding: '0.5rem 0.15rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700,
                        border: selected ? '1px solid var(--primary)' : '1px solid var(--border)',
                        background: selected ? 'var(--primary-light)' : 'var(--surface)',
                        color: selected ? 'var(--primary)' : 'var(--text-3)',
                      }}>{day.label}</button>
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
                <label>Late Grace Period (minutes)</label>
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
              {formError && <p className="error-message">{formError}</p>}
              <div className="grid-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary" style={{ margin: 0 }}>
                  {formLoading ? 'Saving...' : editTarget ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">{toast}</div>
      )}
    </div>
  );
};

export default DeploymentsPage;
