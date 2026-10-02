import { useCallback, useEffect, useMemo, useState } from 'react';
import { archiveRequirement, createRequirement, deleteRequirement, getRequirements, updateRequirement } from '../../api/documents';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import SkeletonPage from './Skeleton';
import VectorIcon from './VectorIcon';

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
  const [query, setQuery] = useState('');
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

  const visibleRequirements = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requirements.filter(item => {
      if (!showArchived && item.is_active === false) return false;
      if (showArchived && item.is_active !== false) return false;
      return !q || `${item.name} ${item.description || ''}`.toLowerCase().includes(q);
    });
  }, [requirements, showArchived, query]);
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

  const requestDelete = () => {
    if (!editing?.id || saving) return;
    const target = editing;
    setConfirmation({
      title: `Delete “${target.name}”?`,
      message: 'This permanently removes the requirement. Requirements with student submissions cannot be deleted — archive them instead.',
      confirmLabel: 'Delete requirement',
      danger: true,
      onConfirm: async () => {
        setConfirmation(null); setError(''); setNotice('');
        try {
          const response = await deleteRequirement(target.id);
          setNotice(response.data.message);
          setEditing(null);
          await load();
        } catch (requestError) {
          setError(requestError.response?.data?.message || 'Unable to delete this requirement.');
        }
      },
    });
  };

  const activeCount = requirements.length - archivedCount;

  return <div className="req">
    <section className="req-hero" aria-label="Document requirements summary">
      <div className="req-hero-glow" aria-hidden="true" />
      <div className="req-hero-top">
        <div>
          <p className="req-eyebrow"><VectorIcon name="document" size={12} /> Documents</p>
          <h1 className="req-title">Requirements</h1>
          <p className="req-sub">{activeCount} active{archivedCount > 0 ? ` · ${archivedCount} archived` : ''}</p>
        </div>
        <button type="button" className="req-new" onClick={openCreate}>
          <VectorIcon name="plus" size={16} /> Add
        </button>
      </div>
    </section>

    <div className="req-tabs" role="tablist" aria-label="Requirement filter">
      <button type="button" role="tab" aria-selected={!showArchived}
        className={`req-tab${!showArchived ? ' is-on' : ''}`} onClick={() => setShowArchived(false)}>
        Active{activeCount > 0 ? ` · ${activeCount}` : ''}
      </button>
      <button type="button" role="tab" aria-selected={showArchived}
        className={`req-tab${showArchived ? ' is-on' : ''}`} onClick={() => setShowArchived(true)}>
        Archived{archivedCount > 0 ? ` · ${archivedCount}` : ''}
      </button>
    </div>

    <label className="req-search">
      <VectorIcon name="search" size={14} />
      <input
        type="search"
        placeholder="Search requirements…"
        value={query}
        onChange={event => setQuery(event.target.value)}
        aria-label="Search requirements"
      />
      {query && (
        <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
          <VectorIcon name="x" size={14} />
        </button>
      )}
    </label>

    {notice && <div className="status-message success-message" role="status">{notice}</div>}
    {error && <div className="error-message" role="alert">{error}</div>}

    {loading ? <SkeletonPage variant="list" label="Loading requirements" /> : visibleRequirements.length === 0 ? (
      <div className="card"><EmptyState
        title={requirements.length ? 'Nothing matches' : 'No requirements yet'}
        sub={requirements.length ? 'Try another search or tab.' : 'Add the first requirement so students know what to submit.'}
        action={requirements.length ? undefined : openCreate}
        actionLabel={requirements.length ? undefined : 'Add requirement'}
      /></div>
    ) : (
      <div className="req-list">
        {visibleRequirements.map(requirement => <article className="req-row" key={requirement.id}>
          <div className="req-copy">
            <strong>{requirement.name}</strong>
            {requirement.description && <small>{requirement.description}</small>}
            <span className="req-badges">
              <span className={`badge ${requirement.is_required ? 'badge-danger' : 'badge-gray'}`}>{requirement.is_required ? 'Required' : 'Optional'}</span>
              {requirement.deadline_days_before_ojt != null && (
                <span className="badge badge-gray" title="Due before OJT start">{requirement.deadline_days_before_ojt}d before OJT</span>
              )}
              {requirement.is_active === false && <span className="badge badge-warning">Archived</span>}
            </span>
          </div>
          <div className="req-actions">
            <button type="button" className="req-iconbtn" onClick={() => openEdit(requirement)} aria-label={`Edit ${requirement.name}`}>
              <VectorIcon name="pencil" size={15} />
            </button>
            {requirement.is_active === false
              ? <button type="button" className="req-iconbtn is-ok" onClick={() => reactivate(requirement)} aria-label={`Reactivate ${requirement.name}`}>
                <VectorIcon name="check" size={15} />
              </button>
              : <button type="button" className="req-iconbtn is-warn" onClick={() => requestArchive(requirement)} aria-label={`Archive ${requirement.name}`}>
                <VectorIcon name="inbox" size={15} />
              </button>}
          </div>
        </article>)}
      </div>
    )}

    {editing && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeForm(); }}>
      <div className="modal-content req-sheet" role="dialog" aria-modal="true" aria-labelledby="requirement-form-title">
        <div className="modal-handle" />
        <h2 className="modal-title" id="requirement-form-title">{editing.id ? 'Edit requirement' : 'New requirement'}</h2>
        <form onSubmit={submit}>
          <div className="form-group"><label htmlFor="requirement-name">Name</label><input id="requirement-name" required maxLength="255" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="e.g. Medical certificate" /></div>
          <div className="form-group"><label htmlFor="requirement-description">Details <em>optional</em></label><textarea id="requirement-description" rows="2" maxLength="2000" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="What should the student submit?" /></div>
          <div className="grid-2">
            <div className="form-group"><label htmlFor="requirement-deadline">Due <em>optional</em></label><input id="requirement-deadline" type="number" min="0" max="365" value={form.deadlineDaysBeforeOjt} onChange={event => setForm({ ...form, deadlineDaysBeforeOjt: event.target.value === '' ? '' : Number(event.target.value) })} placeholder="Days before OJT" /></div>
            <div className="form-group"><label htmlFor="requirement-order">Order</label><input id="requirement-order" type="number" min="0" max="10000" required value={form.sortOrder} onChange={event => setForm({ ...form, sortOrder: Number(event.target.value) })} /></div>
          </div>
          <div className="req-checks">
            <label className="req-check"><input type="checkbox" checked={form.isRequired} onChange={event => setForm({ ...form, isRequired: event.target.checked })} /> Required for completion</label>
            {editing.id && <label className="req-check"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} /> Visible to students</label>}
          </div>
          <div className="modal-actions grid-2">
            <button type="button" className="action-btn action-btn-gray" disabled={saving} onClick={closeForm}>Cancel</button>
            <button type="submit" className="action-btn action-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
          {editing.id && (
            <button type="button" className="req-delete" disabled={saving} onClick={requestDelete}>
              <VectorIcon name="trash" size={14} /> Delete requirement
            </button>
          )}
        </form>
      </div>
    </div>}

    <ConfirmDialog
      open={!!confirmation}
      title={confirmation?.title}
      message={confirmation?.message}
      confirmLabel={confirmation?.confirmLabel}
      danger={confirmation?.danger}
      onCancel={() => setConfirmation(null)}
      onConfirm={confirmation?.onConfirm}
    />
  </div>;
};

export default DocumentRequirementsManager;
