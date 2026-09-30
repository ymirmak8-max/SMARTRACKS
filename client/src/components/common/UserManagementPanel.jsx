import { useState, useEffect, useCallback } from 'react';
import { getUsers, createUser, updateUser, toggleUserStatus, deleteUser, resetUserPassword, bulkUsers, getAuditLogs } from '../../api/users';
import useAuth from '../../hooks/useAuth';
import EmptyState from './EmptyState';
import ConfirmDialog from './ConfirmDialog';
import VectorIcon from './VectorIcon';
import StudentImportButton from './StudentImportButton';
import SlidingSubnav from './SlidingSubnav';
import SkeletonPage from './Skeleton';
import { MAX_PHONE_DIGITS, sanitizePhone } from '../../utils/phone';

const ROLES = ['student', 'coordinator', 'supervisor'];
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
  student: '#2563EB', coordinator: '#059669', supervisor: '#D97706',
};

const UserManagementPanel = ({ onToast }) => {
  const { user } = useAuth();
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
  const [confirmation, setConfirmation] = useState(null);
  const [passwordReset, setPasswordReset] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [autoOpened, setAutoOpened] = useState(false);

  const showToast = useCallback((msg, type = 'success') => {
    if (onToast) onToast(msg, type);
    else {
      setToast(msg); setToastType(type);
      setTimeout(() => setToast(''), 6000);
    }
  }, [onToast]);

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
    if (!autoOpened) {
      const firstPending = users.find(u => u.approval_status === 'pending');
      if (firstPending) {
        setOpenId(firstPending.id);
        setAutoOpened(true);
      }
    }
  }, [users, autoOpened]);

  useEffect(() => {
    import('../../api/deployments').then(({ getCompanies }) => {
      getCompanies().then(res => setCompanies(res.data.companies)).catch(() => {});
    });
  }, []);

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true); };
  const openEdit = (u) => {
    setEditTarget(u);
    setForm({ firstName: u.first_name, lastName: u.last_name, email: u.email, password: '', role: u.role === 'admin' ? 'coordinator' : u.role, phone: sanitizePhone(u.phone), course: u.course || '', school: u.school || '', companyId: u.company_id || '' });
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

  const pendingApprovals = users.filter(u => u.approval_status === 'pending').length;
  const displayRole = (role) => role === 'admin' ? 'coordinator' : role;

  return (
    <>
      <div className="user-management-page usr">
        <section className="usr-hero" aria-label="User management summary">
          <div className="usr-hero-glow" aria-hidden="true" />
          <div className="usr-hero-top">
            <div>
              <p className="usr-eyebrow"><VectorIcon name="users" size={12} /> Users</p>
              <h1 className="usr-title">
                {pendingApprovals ? `${pendingApprovals} awaiting approval` : `${users.length} accounts`}
              </h1>
              <p className="usr-sub">
                {pendingApprovals ? `${users.length} total accounts` : 'Students, supervisors and coordinators'}
              </p>
            </div>
            <button type="button" onClick={openCreate} className="usr-new">
              <VectorIcon name="plus" size={16} /> Add user
            </button>
          </div>
          <div className="usr-hero-actions">
            <button type="button" onClick={openAudit} className="usr-ghost">
              <VectorIcon name="clock" size={14} /> Audit
            </button>
            <StudentImportButton onImported={(message) => { showToast(message); fetchUsers(); }} />
          </div>
        </section>

        <div className="usr-tools" role="search" aria-label="Search and filter users">
          <label className="usr-search">
            <VectorIcon name="search" size={14} />
            <input
              type="search"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search users by name, email, or role"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <VectorIcon name="x" size={14} />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={() => { setShowApprovalOnly(!showApprovalOnly); setSelectedIds([]); setSelectAll(false); }}
            className={`usr-approve${showApprovalOnly ? ' is-on' : ''}`}
            aria-pressed={showApprovalOnly}
          >
            Approvals{pendingApprovals > 0 ? ` · ${pendingApprovals}` : ''}
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
              ]}
            />
            {selectedIds.length > 0 && (
              <div className="usr-bulk" role="group" aria-label="Bulk actions">
                <span>{selectedIds.length} selected</span>
                {!selectAll && (
                  <button type="button" className="usr-link" onClick={() => { setSelectedIds(users.map(u => u.id)); setSelectAll(true); }}>
                    Select all
                  </button>
                )}
                <select
                  aria-label="Bulk actions"
                  value=""
                  onChange={(e) => {
                    const val = e.target.value; if (!val) return;
                    handleBulkAction(val); e.target.selectedIndex = 0;
                  }}
                >
                  <option value="">Bulk actions</option>
                  <option value="approve">Approve</option>
                  <option value="activate">Activate</option>
                  <option value="deactivate">Deactivate</option>
                  <option value="delete">Delete</option>
                  <option value="reject">Reject</option>
                </select>
                <button type="button" onClick={() => { setSelectedIds([]); setSelectAll(false); }} aria-label="Clear selection">
                  <VectorIcon name="x" size={14} />
                </button>
              </div>
            )}

            {loading ? (
              <SkeletonPage variant="list" label="Loading users" />
            ) : users.length === 0 ? (
              <div className="card"><EmptyState type="default" title="No users found" sub="Try a different search or add a new user." action={openCreate} actionLabel="Add User" actionIcon="plus" /></div>
            ) : users.map(u => {
              const isOpen = openId === u.id;
              const roleColor = roleBadgeColor[displayRole(u.role)] || '#059669';
              return (
                <article className={`usr-row${isOpen ? ' is-open' : ''}`} key={u.id}>
                  <div className="usr-head">
                    <button
                      type="button"
                      className="usr-head-main"
                      onClick={() => setOpenId(isOpen ? null : u.id)}
                      aria-expanded={isOpen}
                      aria-label={`${u.first_name} ${u.last_name}`}
                    >
                      <span className="usr-ava" style={{ background: `${roleColor}1f`, color: roleColor }} aria-hidden="true">
                        {`${u.first_name?.[0] || ''}${u.last_name?.[0] || ''}`.toUpperCase()}
                      </span>
                      <span className="usr-copy">
                        <strong>{u.first_name} {u.last_name}</strong>
                        <small>{u.email}</small>
                      </span>
                      <span className="usr-badges">
                        <span className="badge" style={{ background: `${roleColor}22`, color: roleColor, textTransform: 'capitalize' }}>{displayRole(u.role)}</span>
                        {u.approval_status === 'pending'
                          ? <span className="badge badge-warning">Pending</span>
                          : !u.is_active && <span className="badge badge-danger">Inactive</span>}
                      </span>
                      <VectorIcon name="chevronRight" size={16} className="usr-chev" />
                    </button>
                    <label className="usr-select" aria-label={`Select ${u.first_name} ${u.last_name}`}>
                      <input type="checkbox" checked={selectedIds.includes(u.id)} onChange={() => {
                        const next = selectedIds.includes(u.id) ? selectedIds.filter(id => id !== u.id) : [...selectedIds, u.id];
                        setSelectedIds(next); setSelectAll(next.length === users.length);
                      }} />
                    </label>
                  </div>
                  {isOpen && (
                    <div className="usr-body">
                      {(u.course || u.phone || u.company_name) && (
                        <p className="usr-meta">
                          {[u.course, u.phone, u.company_name].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      <div className="usr-actions">
                        <button onClick={() => openEdit(u)} className="usr-act is-primary"><VectorIcon name="pencil" size={14} /> Edit</button>
                        <button onClick={() => handleResetPassword(u)} disabled={u.id === user?.id}
                          title={u.id === user?.id ? 'Use Account settings to change your own password' : undefined}
                          className="usr-act"><VectorIcon name="lock" size={14} /> Password</button>
                        <button onClick={() => handleToggleStatus(u.id)} disabled={u.id === user?.id}
                          title={u.id === user?.id ? 'You cannot change your own status' : undefined}
                          className={`usr-act${u.approval_status === 'pending' || !u.is_active ? ' is-ok' : ' is-warn'}`}>
                          <VectorIcon name={u.approval_status === 'pending' || !u.is_active ? 'check' : 'alert'} size={14} />
                          {u.approval_status === 'pending' ? 'Approve' : u.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => handleDelete(u.id, `${u.first_name} ${u.last_name}`)}
                          disabled={u.id === user?.id} title={u.id === user?.id ? 'You cannot delete your own account' : undefined}
                          className="usr-act is-danger"><VectorIcon name="trash" size={14} /> Delete</button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

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

      {/* User Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !formLoading && setShowModal(false)}>
          <div className="modal-content usr-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">{editTarget ? 'Edit user' : 'New user'}</div>
            <form onSubmit={handleSubmit}>
              <p className="usr-group-label">Account</p>
              <div className="grid-2">
                <div className="form-group">
                  <label>First name</label>
                  <input type="text" name="firstName" value={form.firstName} onChange={handleFormChange} required autoComplete="given-name" />
                </div>
                <div className="form-group">
                  <label>Last name</label>
                  <input type="text" name="lastName" value={form.lastName} onChange={handleFormChange} required autoComplete="family-name" />
                </div>
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" name="email" value={form.email} onChange={handleFormChange} required autoComplete="email" />
              </div>
              <div className="form-group">
                <label>Phone <em>optional</em></label>
                  <input type="tel" name="phone" inputMode="numeric" autoComplete="tel" maxLength={MAX_PHONE_DIGITS}
                    value={form.phone} onChange={handleFormChange} placeholder="09XXXXXXXXX" />
              </div>
              <div className="form-group">
                <label>{editTarget ? 'New password (leave blank to keep)' : 'Temporary password'}</label>
                <input type="password" name="password" value={form.password}
                  onChange={handleFormChange} required={!editTarget} autoComplete="new-password"
                  placeholder={editTarget ? 'Leave blank to keep the current password' : 'User changes this on first login'} />
              </div>
              {!editTarget && (
                <p className="usr-warn"><VectorIcon name="alert" size={14} /> Share this temporary password securely with the user.</p>
              )}
              <p className="usr-group-label">Assignment</p>
              <div className="form-group">
                <label>Role</label>
                <select name="role" value={form.role} onChange={handleFormChange}>
                  {ROLES.map(r => <option key={r} value={r} style={{ textTransform: 'capitalize' }}>{r}</option>)}
                </select>
              </div>
              {form.role === 'student' && (
                <>
                  <div className="form-group">
                    <label>Course <em>optional</em></label>
                    <select name="course" value={form.course} onChange={handleFormChange}>
                      <option value="">Select course...</option>
                      {COURSES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>School <em>optional</em></label>
                    <input type="text" name="school" value={form.school} onChange={handleFormChange} placeholder="School / University" />
                  </div>
                </>
              )}
              {(form.role === 'supervisor' || form.role === 'coordinator') && companies.length > 0 && (
                <div className="form-group">
                  <label>Company <em>optional</em></label>
                  <select name="companyId" value={form.companyId} onChange={handleFormChange}>
                    <option value="">Select company...</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {formError && <p className="error-message">{formError}</p>}
              <div className="modal-actions grid-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="action-btn action-btn-gray" disabled={formLoading}>Cancel</button>
                <button type="submit" disabled={formLoading} className="action-btn action-btn-primary">
                  {formLoading ? 'Saving…' : editTarget ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

      {toast && !onToast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </>
  );
};

export default UserManagementPanel;
