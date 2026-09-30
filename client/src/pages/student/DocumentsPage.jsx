import { useState, useEffect, useRef, useCallback } from 'react';
import { getMyDocuments, uploadDocument } from '../../api/documents';
import EmptyState from '../../components/common/EmptyState';
import SkeletonPage from '../../components/common/Skeleton';
import VectorIcon from '../../components/common/VectorIcon';

const STATUS_STYLES = {
  not_submitted: { bg: 'var(--surface-2)', color: 'var(--text-2)', label: 'Not Submitted' },
  pending: { bg: 'var(--warning-light)', color: 'var(--warning)', label: 'Pending Review' },
  approved: { bg: 'var(--success-light)', color: 'var(--success)', label: 'Approved' },
  returned: { bg: 'var(--danger-light)', color: 'var(--danger)', label: 'Returned' },
};

const DocumentsPage = ({ onBack: _onBack }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [uploading, setUploading] = useState(null);
  const fileInputRef = useRef(null);
  const [activeReq, setActiveReq] = useState(null);
  const [loadError, setLoadError] = useState('');

  const showToast = useCallback((msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await getMyDocuments();
      setDocuments(res.data.documents);
    } catch (error) {
      const message = error.response?.data?.message || 'Failed to load documents.';
      setLoadError(message);
      showToast(message, 'error');
    }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const handleFileSelect = (requirementId) => {
    setActiveReq(requirementId);
    fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.type)) { showToast('Only PDF, Word, JPG, and PNG files are allowed.', 'error'); e.target.value = ''; return; }
    if (file.size > 8 * 1024 * 1024) { showToast('File must be smaller than 8 MB.', 'error'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setUploading(activeReq);
      try {
        await uploadDocument({
          requirementId: activeReq,
          fileUrl: reader.result,
          fileName: file.name,
        });
        showToast('Document submitted successfully.');
        await fetchDocuments();
      } catch (err) {
        showToast(err.response?.data?.message || 'Upload failed.', 'error');
      } finally {
        setUploading(null);
        setActiveReq(null);
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const approved = documents.filter(d => d.document?.status === 'approved').length;
  const total = documents.length;

  return (
    <div className="docs-page">
      {/* Header */}
      <div className="docs-head">
        <div>
          <h2 className="docs-title">Documents</h2>
          <p className="docs-sub">{approved} of {total} approved</p>
        </div>
        {total > 0 && (
          <div className="docs-progress" role="progressbar" aria-valuenow={approved} aria-valuemin={0} aria-valuemax={total} aria-label="Documents approved">
            <div className="docs-progress-fill" style={{ width: `${total ? (approved / total) * 100 : 0}%` }} />
          </div>
        )}
      </div>

      <input
        type="file" ref={fileInputRef} style={{ display: 'none' }}
        onChange={handleFileChange}
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
      />

      {loading ? (
        <SkeletonPage variant="list" label="Loading documents" />
      ) : loadError ? (
        <div className="card"><EmptyState title="Documents unavailable" sub={loadError} action={fetchDocuments} actionLabel="Try again" /></div>
      ) : documents.length === 0 ? (
        <div className="card"><EmptyState title="No document requirements yet" sub="Your school has not published any document requirements. Check back later or contact your coordinator." /></div>
      ) : (
        <ul className="docs-list">
          {documents.map(({ requirement, document }) => {
            const status = document?.status || 'not_submitted';
            const style = STATUS_STYLES[status];
            const isUploading = uploading === requirement.id;

            return (
              <li key={requirement.id} className="docs-row">
                <span className="docs-row-icon" aria-hidden="true"><VectorIcon name="document" size={17} /></span>
                <span className="docs-row-copy">
                  <strong>{requirement.name}{requirement.is_required && <i className="docs-required" title="Required">*</i>}</strong>
                  <small>
                    {document?.submitted_at
                      ? `Sent ${new Date(document.submitted_at).toLocaleDateString()}`
                      : requirement.description || 'Not submitted yet'}
                  </small>
                  {document?.remarks && status === 'returned' && (
                    <small className="docs-remarks"><VectorIcon name="message" size={12} /> {document.remarks}</small>
                  )}
                </span>
                <span className="badge docs-badge" style={{ background: style.bg, color: style.color }}>
                  {style.label}
                </span>
                <span className="docs-row-actions">
                  {document?.file_url && (
                    <a href={document.file_url} target="_blank" rel="noreferrer" className="docs-icon-btn" aria-label={`View ${requirement.name}`}><VectorIcon name="eye" size={15} /></a>
                  )}
                  {status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => handleFileSelect(requirement.id)}
                      disabled={isUploading}
                      className="docs-icon-btn is-primary"
                      aria-label={status === 'not_submitted' ? `Upload ${requirement.name}` : `Re-upload ${requirement.name}`}
                    >
                      <VectorIcon name="upload" size={15} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default DocumentsPage;
