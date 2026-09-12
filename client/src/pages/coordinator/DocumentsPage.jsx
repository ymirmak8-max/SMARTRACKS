import { useState, useEffect, useRef, useCallback } from 'react';
import { getMyDocuments, uploadDocument } from '../../api/documents';
import SkeletonPage from '../../components/common/Skeleton';

const STATUS_STYLES = {
  not_submitted: { bg: '#F1F5F9', color: '#64748B', label: 'Not Submitted' },
  pending: { bg: '#FEF3C7', color: '#92400E', label: 'Pending Review' },
  approved: { bg: '#DCFCE7', color: '#16A34A', label: 'Approved' },
  returned: { bg: '#FEE2E2', color: '#DC2626', label: 'Returned for Revision' },
};

const DocumentsPage = ({ onBack }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [uploading, setUploading] = useState(null);
  const fileInputRef = useRef(null);
  const [activeReq, setActiveReq] = useState(null);

  const showToast = useCallback((msg, type = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 6000);
  }, []);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyDocuments();
      setDocuments(res.data.documents);
    } catch {
      showToast('Failed to load documents.', 'error');
    } finally {
      setLoading(false);
    }
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

    // The API validates the payload again and persists it to cloud storage.
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
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button onClick={onBack} style={{
          padding: '0.4rem 0.9rem', background: '#F1F5F9',
          border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500,
        }}><span className="icon-label"><VectorIcon name="back" size={15} /> Back</span></button>
        <div>
          <h2 style={{ margin: 0 }}>Document Requirements</h2>
          <p style={{ color: '#64748B', fontSize: '0.85rem', margin: '0.2rem 0 0' }}>
            {approved} of {total} requirements approved
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{
        background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0',
        padding: '1.25rem', marginBottom: '1.5rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Overall Completion</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#2563EB' }}>
            {total > 0 ? Math.round((approved / total) * 100) : 0}%
          </span>
        </div>
        <div style={{ background: '#F1F5F9', borderRadius: '999px', height: '8px' }}>
          <div style={{
            height: '100%', borderRadius: '999px', background: '#2563EB',
            width: `${total > 0 ? (approved / total) * 100 : 0}%`,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
      />

      {/* Documents List */}
      {loading ? (
        <SkeletonPage variant="list" label="Loading documents" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {documents.map(({ requirement, document }) => {
            const status = document?.status || 'not_submitted';
            const style = STATUS_STYLES[status];
            const isUploading = uploading === requirement.id;

            return (
              <div key={requirement.id} style={{
                background: '#fff', borderRadius: '12px',
                border: '1px solid #E2E8F0', padding: '1.25rem',
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', gap: '1rem',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem' }}>
                    <span style={{ fontWeight: 600 }}>{requirement.name}</span>
                    {requirement.is_required && (
                      <span style={{
                        background: '#FEE2E2', color: '#DC2626',
                        fontSize: '0.7rem', fontWeight: 600,
                        padding: '0.1rem 0.4rem', borderRadius: '4px',
                      }}>Required</span>
                    )}
                    <span style={{
                      background: style.bg, color: style.color,
                      fontSize: '0.75rem', fontWeight: 600,
                      padding: '0.2rem 0.6rem', borderRadius: '999px',
                    }}>{style.label}</span>
                  </div>
                  {requirement.description && (
                    <p style={{ color: '#64748B', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                      {requirement.description}
                    </p>
                  )}
                  {document?.remarks && status === 'returned' && (
                    <div style={{
                      background: '#FEF2F2', border: '1px solid #FECACA',
                      borderRadius: '6px', padding: '0.5rem 0.75rem',
                      fontSize: '0.85rem', color: '#DC2626', marginTop: '0.5rem',
                    }}>
                      <span className="icon-label"><VectorIcon name="message" size={14} /> Remarks: {document.remarks}</span>
                    </div>
                  )}
                  {document?.submitted_at && (
                    <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: '0.3rem 0 0' }}>
                      Submitted: {new Date(document.submitted_at).toLocaleDateString()}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '120px' }}>
                  {status !== 'approved' && (
                    <button
                      onClick={() => handleFileSelect(requirement.id)}
                      disabled={isUploading}
                      style={{
                        padding: '0.5rem 1rem', background: 'var(--primary)', color: 'var(--on-primary)',
                        border: 'none', borderRadius: '6px', cursor: 'pointer',
                        fontSize: '0.85rem', fontWeight: 500, whiteSpace: 'nowrap',
                      }}
                    >
                      {isUploading ? 'Uploading...' : <span className="icon-label"><VectorIcon name={status === 'not_submitted' ? 'paperclip' : 'refresh'} size={15} /> {status === 'not_submitted' ? 'Upload' : 'Re-upload'}</span>}
                    </button>
                  )}
                  {document?.file_url && (
                    <a
                      href={document.file_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '0.5rem 1rem', background: '#F1F5F9',
                        border: 'none', borderRadius: '6px', cursor: 'pointer',
                        fontSize: '0.85rem', fontWeight: 500, textAlign: 'center',
                        textDecoration: 'none', color: '#1E293B',
                      }}
                    >
                      <span className="icon-label"><VectorIcon name="eye" size={15} /> View</span>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toastType === 'error' ? 'toast-error' : ''}`}>{toast}</div>
      )}
    </div>
  );
};

export default DocumentsPage;
import VectorIcon from '../../components/common/VectorIcon';
