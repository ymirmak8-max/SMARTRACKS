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
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Documents</h2>
        <p style={{ color: 'var(--text-3)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
          {approved} of {total} requirements approved
        </p>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {documents.map(({ requirement, document }) => {
            const status = document?.status || 'not_submitted';
            const style = STATUS_STYLES[status];
            const isUploading = uploading === requirement.id;

            return (
              <div key={requirement.id} className="card" style={{ padding: '1rem' }}>
                {/* Top row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{requirement.name}</span>
                      {requirement.is_required && (
                        <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>Required</span>
                      )}
                    </div>
                    {requirement.description && (
                      <p style={{ color: 'var(--text-3)', fontSize: '0.8rem', margin: 0, lineHeight: 1.4 }}>
                        {requirement.description}
                      </p>
                    )}
                    {document?.remarks && status === 'returned' && (
                      <div style={{
                        background: 'var(--danger-light)', border: '1px solid #FECACA',
                        borderRadius: 'var(--radius)', padding: '0.4rem 0.65rem',
                        fontSize: '0.78rem', color: 'var(--danger)', marginTop: '0.5rem',
                      }}><span className="icon-label"><VectorIcon name="message" size={14} /> {document.remarks}</span></div>
                    )}
                    {document?.submitted_at && (
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-3)', margin: '0.3rem 0 0' }}>
                        Submitted: {new Date(document.submitted_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  {/* Right side */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', flexShrink: 0 }}>
                    <span className="badge" style={{ background: style.bg, color: style.color }}>
                      {style.label}
                    </span>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {document?.file_url && (
                        <a href={document.file_url} target="_blank" rel="noreferrer" style={{
                          padding: '0.35rem 0.65rem', background: 'var(--surface-2)',
                          borderRadius: '6px', fontSize: '0.78rem', fontWeight: 500,
                          textDecoration: 'none', color: 'var(--text-2)',
                        }} aria-label="View document"><VectorIcon name="eye" size={15} /></a>
                      )}
                      {status !== 'approved' && (
                        <button
                          onClick={() => handleFileSelect(requirement.id)}
                          disabled={isUploading}
                          style={{
                            padding: '0.35rem 0.75rem',
                            background: 'var(--primary)', color: 'var(--on-primary)',
                            border: 'none', borderRadius: '6px',
                            cursor: isUploading ? 'not-allowed' : 'pointer',
                            fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
                          }}
                        >
                          {isUploading ? '...' : status === 'not_submitted' ? ' Upload' : ' Re-upload'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default DocumentsPage;
