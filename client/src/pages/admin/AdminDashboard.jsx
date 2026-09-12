import { useState, useEffect, useCallback } from 'react';
import { getUsers, createUser, updateUser, toggleUserStatus, deleteUser, resetUserPassword, bulkUsers, getAuditLogs } from '../../api/users';
import { scheduleReport } from '../../api/exports';
import useAuth from '../../hooks/useAuth';
import DeploymentsPage from './DeploymentsPage';
import EmptyState from '../../components/common/EmptyState';
import Sidebar from '../../components/common/Sidebar';
import DashboardTopbar from '../../components/common/DashboardTopbar';
import DashboardBottomNav from '../../components/common/DashboardBottomNav';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { MetricCard, PageHeader } from '../../components/common/DashboardUI';
import ReportSchedulerModal from '../../components/common/ReportSchedulerModal';
import ExportHistoryModal from '../../components/common/ExportHistoryModal';
import VectorIcon from '../../components/common/VectorIcon';
import SystemHealthPanel from '../../components/common/SystemHealthPanel';
import useDashboardNavigation from '../../hooks/useDashboardNavigation';
import SecuritySettings from '../../components/common/SecuritySettings';
import NotificationPreferences from '../../components/common/NotificationPreferences';
import StudentImportButton from '../../components/common/StudentImportButton';
import DocumentRequirementsManager from '../../components/common/DocumentRequirementsManager';
import CollapsibleSection from '../../components/common/CollapsibleSection';
import WorkspacePane from '../../components/common/WorkspacePane';
import SlidingSubnav from '../../components/common/SlidingSubnav';
import SkeletonPage from '../../components/common/Skeleton';
import { MAX_PHONE_DIGITS, sanitizePhone } from '../../utils/phone';
import ProfileAvatar from '../../components/common/ProfileAvatar';

const ROLES = ['admin', 'student', 'coordinator', 'supervisor'];
const EMPTY_FORM = { firstName: '', lastName: '', email: '', password: '', role: 'student', phone: '', course: '', school: '', companyId: '' };
const COURSES = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Computer Science',
  'College of Business Education',
  'College of Criminal Justice Education',
  'Psychology',
  'College of Teacher Education',
];
const roleBadgeColor = {
  admin: '#7C3AED', student: '#2563EB', coordinator: '#059669', supervisor: '#D97706',
};
const ADMIN_VIEWS = ['users', 'deployments', 'requirements', 'health', 'account'];

const AdminDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useDashboardNavigation('users', ADMIN_VIEWS);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [showApprovalOnly, setShowApprovalOnly] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [auditTotal, setAuditTotal] = useState(0);
  const [companies, setCompanies] = useState([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showExportHistory, setShowExportHistory] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [passwordReset, setPasswordReset] = useState(null);

  const showToast = useCallback((msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const loadAuditLogs = useCallback(async ({ searchValue = auditSearch, offset = 0, append = false } = {}) => {
    setAuditLoading(true);
    setAuditError('');
    try {
      const res = await getAuditLogs({ search: searchValue.trim() || undefined, limit: 30, offset });
      setAuditLogs(current => append ? [...current, ...res.data.logs] : res.data.logs);
      setAuditTotal(res.data.total || 0);
    } catch (error) {
      setAuditError(error.response?.data?.message || 'Failed to load audit history.');
    } finally {
      setAuditLoading(false);
    }
  }, [auditSearch]);

  const openAudit = () => {
    setAuditOpen(true);
    loadAuditLogs({ searchValue: '', offset: 0 });
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search, role: filterRole };
      if (showApprovalOnly) params.approval_status = 'pending';
      const res = await getUsers(params);
      const nextUsers = res.data.users;
      setUsers(nextUsers);
      setSelectedIds(current => current.filter(id => nextUsers.some(nextUser => nextUser.id === id)));
      setSelectAll(false);
    } catch { showToast('Failed to load users.', 'error'); }
    finally { setLoading(false); }
  }, [filterRole, search, showApprovalOnly, showToast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    import('../../api/deployments').then(({ getCompanies }) => {
      getCompanies().then(res => setCompanies(res.data.companies)).catch(() => {});
    });
  }, []);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true); };
  const openEdit = (u) => {
    setEditTarget(u);
    setForm({ firstName: u.first_name, lastName: u.last_name, email: u.email, password: '', role: u.role, phone: sanitizePhone(u.phone), course: u.course || '', school: u.school || '', companyId: u.company_id || '' });
    setFormError(''); setShowModal(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: name === 'phone' ? sanitizePhone(value) : value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setFormError(''); setFormLoading(true);
    try {
      if (editTarget) {
        await updateUser(editTarget.id, form);
        showToast('User updated.');
      } else {
        await createUser(form);
        showToast('User created and activated.');
      }
      setShowModal(false); fetchUsers();
    } catch (err) { setFormError(err.response?.data?.message || 'Something went wrong.'); }
    finally { setFormLoading(false); }
  };

  const handleToggleStatus = async (id) => {
    try { const res = await toggleUserStatus(id); showToast(res.data.message); fetchUsers(); }
    catch { showToast('Failed to update status.', 'error'); }
  };

  const handleResetPassword = (target) => {
    if (target.id === user?.id) {
      showToast('Use Account settings to change your own password.', 'error');
      return;
    }
    setConfirmation({
      title: `Reset password for ${target.first_name} ${target.last_name}?`,
      message: 'Their current password and signed-in sessions will stop working. A temporary password will be shown once so you can share it securely.',
      confirmLabel: 'Reset password',
      onConfirm: async () => {
        setConfirmation(null);
        try {
          const res = await resetUserPassword(target.id);
          setPasswordReset({
            name: `${target.first_name} ${target.last_name}`,
            email: res.data.email || target.email,
            temporaryPassword: res.data.temporaryPassword,
          });
          showToast(res.data.message);
        } catch (err) {
          showToast(err.response?.data?.message || 'Failed to reset password.', 'error');
        }
      },
    });
  };

  const handleDelete = async (id, name) => {
    setConfirmation({
      title: 'Delete user?',
      message: `${name} will permanently lose access and their account cannot be restored.`,
      confirmLabel: 'Delete user',
      onConfirm: async () => {
        setConfirmation(null);
        try { await deleteUser(id); showToast('User deleted.'); fetchUsers(); }
        catch (err) { showToast(err.response?.data?.message || 'Failed to delete.', 'error'); }
      },
    });
  };

  const executeBulkAction = async (action) => {
    if (selectedIds.length === 0) { showToast('No users selected.', 'error'); return; }
    if (['delete', 'deactivate', 'reject'].includes(action) && selectedIds.includes(user?.id)) {
      showToast('Remove your own account from the selection first.', 'error');
      return;
    }
    try {
      const res = await bulkUsers({ action, ids: selectedIds });
      showToast(res.data.message || 'Bulk action completed.');
      setSelectedIds([]); setSelectAll(false); fetchUsers();
    } catch (err) { showToast(err.response?.data?.message || 'Bulk action failed.', 'error'); }
  };

  const handleBulkAction = async action => {
    if (action !== 'delete') return executeBulkAction(action);
    if (selectedIds.length === 0) return showToast('No users selected.', 'error');
    setConfirmation({
      title: 'Delete selected users?',
      message: `${selectedIds.length} selected account${selectedIds.length === 1 ? '' : 's'} will be permanently deleted.`,
      confirmLabel: `Delete ${selectedIds.length}`,
      onConfirm: () => { setConfirmation(null); executeBulkAction('delete'); },
    });
  };

  const handleScheduleReport = async (options) => {
    try {
      await scheduleReport(options);
      showToast('Report scheduled successfully.');
      setShowScheduleModal(false);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to schedule report', { cause: error });
    }
  };

  const totalUsers = users.length;
  const totalStudents = users.filter(u => u.role === 'student').length;
  const totalActive = users.filter(u => u.is_active).length;
  const totalCoordinators = users.filter(u => u.role === 'coordinator').length;
  const totalSupervisors = users.filter(u => u.role === 'supervisor').length;
  const pendingApprovals = users.filter(u => u.approval_status === 'pending').length;

  const NAV_ITEMS = [
    { key: 'users', icon: <VectorIcon name="users" size={20} />, label: 'Users', badge: pendingApprovals },
    { key: 'deployments', icon: <VectorIcon name="grid" size={20} />, label: 'Deployments' },
    { key: 'requirements', icon: <VectorIcon name="document" size={20} />, label: 'Requirements' },
    { key: 'health', icon: <VectorIcon name="activity" size={20} />, label: 'Health' },
  ];

  return (
    <div className="workspace-shell">

      {/* Sidebar — desktop only */}
      <Sidebar
        user={user}
        navItems={NAV_ITEMS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        role="admin"
        onEditProfile={() => setActiveTab('account')}
      />

      {/* Topbar */}
      <DashboardTopbar role="admin" onEditProfile={() => setActiveTab('account')} />

      {/* Content */}
      <div className="page-content">
        <WorkspacePane key={activeTab}>
        {activeTab === 'deployments' ? (
          <DeploymentsPage onBack={() => setActiveTab('users')} />

        ) : activeTab === 'health' ? (
          <SystemHealthPanel />

        ) : activeTab === 'requirements' ? (
          <DocumentRequirementsManager role="Administrator" />

        ) : activeTab === 'account' ? (
          <div>
            <PageHeader title="Account" subtitle="Update your administrator profile, security, and notification preferences." breadcrumbs={[{ label: 'Administrator' }, { label: 'Account' }]} />
            <div className="card" style={{ marginBottom: '0.875rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <ProfileAvatar
                  initials={`${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}`.toUpperCase()}
                  onToast={showToast}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{user?.first_name} {user?.last_name}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: '0.82rem', marginTop: '0.15rem' }}>{user?.email}</div>
                  <span className="badge badge-primary" style={{ marginTop: '0.4rem', fontSize: '0.72rem' }}><VectorIcon name="settings" size={13} /> System Administrator</span>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '0.875rem' }}>
              <div className="card-title" style={{ marginBottom: '0.5rem' }}>System Overview</div>
              <div className="stat-grid stat-grid-fill">
                <MetricCard label="Total Users" value={totalUsers} />
                <MetricCard label="Students" value={totalStudents} />
                <MetricCard label="Active" value={totalActive} tone="success" />
                <MetricCard label="Coordinators" value={totalCoordinators} />
                <MetricCard label="Supervisors" value={totalSupervisors} tone="warning" />
              </div>
            </div>

            <SecuritySettings />
            <NotificationPreferences />

          </div>

        ) : (
          <div className="user-management-page">
            <PageHeader title="User management" subtitle={`${pendingApprovals} account${pendingApprovals === 1 ? '' : 's'} awaiting approval`} breadcrumbs={[{ label: 'Administrator' }, { label: 'Users' }]} actions={
                      <div className="admin-header-actions">
                        <button type="button" onClick={openAudit} className="btn-compact-primary icon-label"><VectorIcon name="clock" size={16} /> Audit history</button>
                        <StudentImportButton onImported={(message) => { showToast(message); fetchUsers(); }} />
                        <button type="button" onClick={openCreate} className="btn-compact-primary icon-label"><VectorIcon name="plus" size={16} /> Add user account</button>
                      </div>
            } />

            <div className="user-directory-toolbar" role="search" aria-label="Search and filter users">
              <input
                type="search"
                placeholder="Search by name, email, or role"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search users by name, email, or role"
              />
              <button
                type="button"
                onClick={() => { setShowApprovalOnly(!showApprovalOnly); setSelectedIds([]); setSelectAll(false); }}
                className={`btn-compact-primary ${showApprovalOnly ? 'active' : ''}`}
              >
                {showApprovalOnly ? 'Approval queue on' : 'Approval queue'}
              </button>
            </div>
            <SlidingSubnav
              ariaLabel="Filter users by role"
              activeKey={filterRole || 'all'}
              onChange={key => setFilterRole(key === 'all' ? '' : key)}
              items={[
                { key: 'all', label: 'All' },
                { key: 'student', label: 'Students' },
                { key: 'supervisor', label: 'Supervisors' },
                { key: 'coordinator', label: 'Coordinators' },
                { key: 'admin', label: 'Admins' },
              ]}
            />
            <div className="user-directory-tools">
              <label className="user-select-all">
                <input type="checkbox" checked={selectAll} onChange={(e) => {
                  const checked = e.target.checked; setSelectAll(checked);
                  if (checked) setSelectedIds(users.map(u => u.id)); else setSelectedIds([]);
                }} />
                Select all
              </label>
              <select
                aria-label="Bulk actions"
                value=""
                onChange={(e) => {
                  const val = e.target.value; if (!val) return;
                  handleBulkAction(val); e.target.selectedIndex = 0;
                }}
              >
                <option value="">Bulk actions</option>
                <option value="approve">Approve selected</option>
                <option value="activate">Activate selected</option>
                <option value="deactivate">Deactivate selected</option>
                <option value="delete">Delete selected</option>
                <option value="reject">Reject selected</option>
              </select>
            </div>

            {loading ? (
              <SkeletonPage variant="list" label="Loading users" />
            ) : users.length === 0 ? (
              <div className="card"><EmptyState type="default" title="No users found" sub="Try a different search or add a new user." action={openCreate} actionLabel="Add User" actionIcon="plus" /></div>
            ) : users.map(u => (
              <CollapsibleSection
                key={u.id}
                title={`${u.first_name} ${u.last_name}`}
                subtitle={`${u.email} · ${u.role}${u.approval_status === 'pending' ? ' · pending' : ''}`}
                defaultOpen={u.approval_status === 'pending'}
              >
                <div className="admin-user-card-header">
                  <div className="admin-user-identity">
                    <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => {
                      const next = selectedIds.includes(u.id) ? selectedIds.filter(id => id !== u.id) : [...selectedIds, u.id];
                      setSelectedIds(next); setSelectAll(next.length === users.length);
                    }} />
                    <div className="admin-user-copy">
                      {u.course && <div className="icon-label" style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}><VectorIcon name="education" size={13} /> {u.course}</div>}
                    </div>
                  </div>
                  <div className="admin-user-badges">
                    <span className="badge" style={{ background: roleBadgeColor[u.role] + '22', color: roleBadgeColor[u.role], textTransform: 'capitalize' }}>{u.role}</span>
                    <span className="badge" style={{
                      background: u.is_active ? 'var(--success-light)' : 'var(--danger-light)',
                      color: u.is_active ? 'var(--success)' : 'var(--danger)',
                    }}>{u.approval_status === 'pending' ? 'Pending approval' : u.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                </div>
                {u.phone && <div className="icon-label" style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: '0.35rem' }}><VectorIcon name="phone" size={14} /> {u.phone}</div>}
                {u.company_name && <div className="icon-label" style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: '0.5rem' }}><VectorIcon name="building" size={14} /> {u.company_name}</div>}
                <div className="dashboard-row-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button onClick={() => openEdit(u)} className="action-btn action-btn-primary icon-label" style={{ flex: 1 }}><VectorIcon name="pencil" size={15} /> Edit</button>
                  <button onClick={() => handleResetPassword(u)} disabled={u.id === user?.id}
                    title={u.id === user?.id ? 'Use Account settings to change your own password' : undefined}
                    className="action-btn action-btn-gray icon-label" style={{ flex: 1 }}>
                    <VectorIcon name="lock" size={15} /> Reset password
                  </button>
                  <button onClick={() => handleToggleStatus(u.id)} disabled={u.id === user?.id}
                    title={u.id === user?.id ? 'You cannot change your own status' : undefined}
                    className={`action-btn icon-label ${u.approval_status === 'pending' || !u.is_active ? 'action-btn-success' : 'action-btn-warning'}`}
                    style={{ flex: 1 }}>
                    <VectorIcon name={u.approval_status === 'pending' || !u.is_active ? 'check' : 'alert'} size={15} />
                    {u.approval_status === 'pending' ? 'Approve' : u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => handleDelete(u.id, `${u.first_name} ${u.last_name}`)}
                    disabled={u.id === user?.id} title={u.id === user?.id ? 'You cannot delete your own account' : undefined}
                    className="action-btn action-btn-danger icon-label" style={{ flex: 1 }}><VectorIcon name="trash" size={15} /> Delete</button>
                </div>
              </CollapsibleSection>
            ))}

            {/* Audit modal */}
            {auditOpen && (
              <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setAuditOpen(false); }}>
                <div className="modal-content audit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-title">
                  <div className="modal-handle" />
                  <div className="audit-modal-header">
                    <div>
                      <h2 className="modal-title" id="audit-title">Audit history</h2>
                      <p>{auditTotal} recorded event{auditTotal === 1 ? '' : 's'}</p>
                    </div>
                    <button type="button" onClick={() => setAuditOpen(false)} className="action-btn action-btn-gray">Close</button>
                  </div>
                  <form className="audit-search" onSubmit={event => { event.preventDefault(); loadAuditLogs({ offset: 0 }); }}>
                    <input type="search" placeholder="Search by action, person, record, IP, or details" value={auditSearch} onChange={(e) => setAuditSearch(e.target.value)} aria-label="Search audit history" />
                    <button type="submit" className="action-btn action-btn-primary" disabled={auditLoading}>Search</button>
                    {auditSearch && <button type="button" className="action-btn action-btn-gray" onClick={() => { setAuditSearch(''); loadAuditLogs({ searchValue: '', offset: 0 }); }}>Clear</button>}
                  </form>
                  {auditError && <div className="error-message" role="alert">{auditError}</div>}
                  <div className="audit-log-list" aria-live="polite" aria-busy={auditLoading}>
                    {auditLoading && auditLogs.length === 0 ? <SkeletonPage variant="list" label="Loading audit history" /> : auditLogs.length === 0 ? <EmptyState title="No audit events found" sub="Try another search or clear the filter." /> : (
                      auditLogs.map(l => (
                        <article key={l.id} className="audit-log-item">
                          <div className="audit-log-heading">
                            <strong>{l.action.replace(/[._]/g, ' ').replace(/\b\w/g, character => character.toUpperCase())}</strong>
                            <span className="badge badge-gray">{l.entity_type.replace(/_/g, ' ')}</span>
                          </div>
                          <div className="audit-log-actor">
                            {l.actor_first_name ? `${l.actor_first_name} ${l.actor_last_name}` : 'System or deleted user'}
                            {l.actor_email && <span>{l.actor_email}</span>}
                          </div>
                          {Object.keys(l.details || {}).length > 0 && <dl className="audit-details">
                            {Object.entries(l.details).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</dd></div>)}
                          </dl>}
                          <div className="audit-log-meta">
                            <time dateTime={l.created_at}>{new Date(l.created_at).toLocaleString()}</time>
                            {l.ip_address && <span>IP {l.ip_address}</span>}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                  {auditLogs.length < auditTotal && <button type="button" className="action-btn action-btn-gray audit-load-more" disabled={auditLoading} onClick={() => loadAuditLogs({ offset: auditLogs.length, append: true })}>{auditLoading ? 'Loading…' : 'Load more'}</button>}
                </div>
              </div>
            )}
          </div>
        )}
        </WorkspacePane>
      </div>

      {/* Bottom Nav — mobile only */}
      <DashboardBottomNav items={NAV_ITEMS} activeKey={activeTab} onChange={setActiveTab} />

      {/* User Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-handle" />
            <div className="modal-title">{editTarget ? 'Edit User' : 'Add New User'}</div>
            <form onSubmit={handleSubmit}>
              <div className="grid-2">
                <div className="form-group">
                  <label>First Name</label>
                  <input type="text" name="firstName" value={form.firstName} onChange={handleFormChange} required />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input type="text" name="lastName" value={form.lastName} onChange={handleFormChange} required />
                </div>
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" name="email" value={form.email} onChange={handleFormChange} required />
              </div>
              <div className="form-group">
                <label>Phone</label>
                  <input type="tel" name="phone" inputMode="numeric" autoComplete="tel" maxLength={MAX_PHONE_DIGITS}
                    value={form.phone} onChange={handleFormChange} placeholder="09XXXXXXXXX" />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select name="role" value={form.role} onChange={handleFormChange}>
                  {ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>)}
                </select>
              </div>
              {form.role === 'student' && (
                <>
                  <div className="form-group">
                    <label>Course</label>
                    <select name="course" value={form.course} onChange={handleFormChange}>
                      <option value="">Select course...</option>
                      {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>School / University</label>
                    <input type="text" name="school" value={form.school} onChange={handleFormChange} placeholder="e.g. University of Example" />
                  </div>
                </>
              )}
              {(form.role === 'supervisor' || form.role === 'coordinator') && companies.length > 0 && (
                <div className="form-group">
                  <label>Assigned Company</label>
                  <select name="companyId" value={form.companyId} onChange={handleFormChange}>
                    <option value="">Select company...</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>{editTarget ? 'New Password (leave blank to keep)' : 'Temporary Password'}</label>
                <input type="password" name="password" value={form.password}
                  onChange={handleFormChange} required={!editTarget}
                  placeholder={editTarget ? 'Leave blank to keep the current password' : 'Temporary password — user changes this on first login'} />
              </div>
              {!editTarget && (
                <div style={{
                  background: 'var(--warning-light)', borderRadius: 'var(--radius)',
                  padding: '0.65rem 0.875rem', fontSize: '0.78rem', color: 'var(--warning)',
                  marginBottom: '0.875rem', display: 'flex', gap: '0.4rem',
                }}>
                  <VectorIcon name="alert" size={16} /> Share this temporary password securely with the user.
                </div>
              )}
              {formError && <p className="error-message">{formError}</p>}
              <div className="grid-2" style={{ marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setShowModal(false)}
                  className="action-btn action-btn-gray" style={{ padding: '0.875rem' }}>Cancel</button>
                <button type="submit" disabled={formLoading} className="btn-primary" style={{ margin: 0 }}>
                  {formLoading ? 'Saving...' : editTarget ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Export Modals */}
      <ReportSchedulerModal
        isOpen={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
        onSchedule={handleScheduleReport}
        reportType="analytics"
        reportTypeLabel="System Report"
      />

      <ExportHistoryModal
        isOpen={showExportHistory}
        onClose={() => setShowExportHistory(false)}
      />
      <ConfirmDialog
        open={!!confirmation}
        title={confirmation?.title}
        message={confirmation?.message}
        confirmLabel={confirmation?.confirmLabel}
        danger
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmation?.onConfirm}
      />
      {passwordReset && (
        <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setPasswordReset(null); }}>
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
            <div className="modal-handle" />
            <h2 className="modal-title" id="reset-password-title">Temporary password</h2>
            <p style={{ color: 'var(--text-2)', marginBottom: '1rem' }}>
              Share this once with {passwordReset.name}. They should sign in and change it afterward.
            </p>
            <div className="form-group">
              <label>Email</label>
              <input readOnly value={passwordReset.email} />
            </div>
            <div className="form-group">
              <label>Temporary password</label>
              <input readOnly value={passwordReset.temporaryPassword} />
            </div>
            <div className="modal-actions grid-2">
              <button type="button" className="action-btn action-btn-gray" onClick={() => setPasswordReset(null)}>Close</button>
              <button type="button" className="btn-primary" style={{ margin: 0 }} onClick={async () => {
                try {
                  await navigator.clipboard.writeText(passwordReset.temporaryPassword);
                  showToast('Temporary password copied.');
                } catch {
                  showToast('Copy the temporary password from the field.', 'error');
                }
              }}>Copy password</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default AdminDashboard;
