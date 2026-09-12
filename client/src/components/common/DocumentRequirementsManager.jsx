import { useCallback, useEffect, useMemo, useState } from 'react';
import { archiveRequirement, createRequirement, getRequirements, updateRequirement } from '../../api/documents';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import { PageHeader } from './DashboardUI';
import SkeletonPage from './Skeleton';

const EMPTY_FORM = {
  name: '', description: '', isRequired: true, deadlineDaysBeforeOjt: '', sortOrder: 0, isActive: true,
};

const requirementPayload = requirement => ({
  name: requirement.name,
  description: requirement.description || '',
  isRequired: requirement.is_required !== false,
  deadlineDaysBeforeOjt: requirement.deadline_days_before_ojt ?? '',
  sortOrder: requirement.sort_order ?? 0,
  isActive: requirement.is_active !== false,
});

const DocumentRequirementsManager = ({ role = 'Administrator' }) => {
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await getRequirements();
      setRequirements(response.data.requirements || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load document requirements.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleRequirements = useMemo(() => requirements.filter(item => showArchived || item.is_active !== false),
    [requirements, showArchived]);
  const archivedCount = requirements.filter(item => item.is_active === false).length;

  const openCreate = () => { setEditing({ id: null }); setForm(EMPTY_FORM); setError(''); setNotice(''); };
  const openEdit = requirement => { setEditing(requirement); setForm(requirementPayload(requirement)); setError(''); setNotice(''); };
  const closeForm = () => { if (!saving) setEditing(null); };

  const submit = async event => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const response = editing.id
        ? await updateRequirement(editing.id, form)
        : await createRequirement(form);
      setNotice(response.data.message);
      setEditing(null);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to save this requirement.');
    } finally { setSaving(false); }
  };

  const reactivate = async requirement => {
    setError(''); setNotice('');
    try {
      const response = await updateRequirement(requirement.id, { ...requirementPayload(requirement), isActive: true });
      setNotice(response.data.message);
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to reactivate this requirement.');
    }
  };

  const requestArchive = requirement => setConfirmation({
    title: 'Archive document requirement?',
    message: `${requirement.name} will no longer appear for new student submissions. Existing submissions and review history will be retained.`,
    confirmLabel: 'Archive requirement',
    onConfirm: async () => {
      setConfirmation(null); setError(''); setNotice('');
      try {
        const response = await archiveRequirement(requirement.id);
        setNotice(response.data.message);
        await load();
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'Unable to archive this requirement.');
      }
    },
  });

  return <div>
    <PageHeader
      eyebrow="Configuration"
      title="Document requirements"
      subtitle="Define the files students must submit and preserve review history when requirements change."
      breadcrumbs={[{ label: role }, { label: 'Document requirements' }]}
      actions={<button type="button" className="btn-compact-primary" onClick={openCreate}>Add requirement</button>}
    />

    <div className="requirements-toolbar">
      <label className="requirements-archive-toggle">
        <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
        Show archived ({archivedCount})
      </label>
      <span>{requirements.filter(item => item.is_active !== false).length} active requirement{requirements.filter(item => item.is_active !== false).length === 1 ? '' : 's'}</span>
    </div>

    {notice && <div className="status-message success-message" role="status">{notice}</div>}
    {error && <div className="error-message" role="alert">{error}</div>}

    {loading ? <SkeletonPage variant="list" label="Loading requirements" /> : visibleRequirements.length === 0 ? (
      <div className="card"><EmptyState title="No document requirements configured" sub="Add the first requirement so students know what to submit." action={openCreate} actionLabel="Add requirement" /></div>
    ) : (
      <div className="requirements-list">
        {visibleRequirements.map(requirement => <article className="card requirement-card" key={requirement.id}>
          <div className="requirement-card-copy">
            <div className="requirement-card-title">
              <strong>{requirement.name}</strong>
              <span className={`badge ${requirement.is_required ? 'badge-danger' : 'badge-gray'}`}>{requirement.is_required ? 'Required' : 'Optional'}</span>
              {requirement.is_active === false && <span className="badge badge-warning">Archived</span>}
            </div>
            {requirement.description && <p>{requirement.description}</p>}
            <small>
              Display order {requirement.sort_order ?? 0}
              {requirement.deadline_days_before_ojt != null ? ` · Deadline offset ${requirement.deadline_days_before_ojt} day${requirement.deadline_days_before_ojt === 1 ? '' : 's'}` : ' · No deadline offset'}
            </small>
          </div>
          <div className="requirement-card-actions">
            <button type="button" className="action-btn action-btn-primary" onClick={() => openEdit(requirement)}>Edit</button>
            {requirement.is_active === false
              ? <button type="button" className="action-btn action-btn-success" onClick={() => reactivate(requirement)}>Reactivate</button>
              : <button type="button" className="action-btn action-btn-warning" onClick={() => requestArchive(requirement)}>Archive</button>}
          </div>
        </article>)}
      </div>
    )}

    {editing && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeForm(); }}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="requirement-form-title">
        <div className="modal-handle" />
        <h2 className="modal-title" id="requirement-form-title">{editing.id ? 'Edit requirement' : 'Add requirement'}</h2>
        <form onSubmit={submit}>
          <div className="form-group"><label htmlFor="requirement-name">Name</label><input id="requirement-name" required maxLength="255" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
          <div className="form-group"><label htmlFor="requirement-description">Description</label><textarea id="requirement-description" rows="3" maxLength="2000" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></div>
          <div className="grid-2">
            <div className="form-group"><label htmlFor="requirement-order">Display order</label><input id="requirement-order" type="number" min="0" max="10000" required value={form.sortOrder} onChange={event => setForm({ ...form, sortOrder: Number(event.target.value) })} /></div>
            <div className="form-group"><label htmlFor="requirement-deadline">Deadline offset (days)</label><input id="requirement-deadline" type="number" min="0" max="365" value={form.deadlineDaysBeforeOjt} onChange={event => setForm({ ...form, deadlineDaysBeforeOjt: event.target.value === '' ? '' : Number(event.target.value) })} placeholder="Days before OJT start, e.g. 7" /></div>
          </div>
          <label className="requirements-checkbox"><input type="checkbox" checked={form.isRequired} onChange={event => setForm({ ...form, isRequired: event.target.checked })} /> Required for completion</label>
          {editing.id && <label className="requirements-checkbox"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> Active and visible to students</label>}
          <div className="modal-actions">
            <button type="button" className="action-btn action-btn-gray" disabled={saving} onClick={closeForm}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save requirement'}</button>
          </div>
        </form>
      </div>
    </div>}

    <ConfirmDialog
      open={!!confirmation}
      title={confirmation?.title}
      message={confirmation?.message}
      confirmLabel={confirmation?.confirmLabel}
      onCancel={() => setConfirmation(null)}
      onConfirm={confirmation?.onConfirm}
    />
  </div>;
};

export default DocumentRequirementsManager;
