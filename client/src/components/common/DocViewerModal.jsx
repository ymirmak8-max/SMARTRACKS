import { useEffect, useState } from 'react';
import api from '../../api/axios';

/**
 * In-app viewer for submitted document files (photos, PDFs).
 * Loads through the authenticated API client so protected files
 * display without opening another browser tab.
 */
const DocViewerModal = ({ file, onClose = () => {} }) => {
  const [objectUrl, setObjectUrl] = useState(null);
  const [mime, setMime] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!file?.url) return undefined;
    if (/^https?:\/\//i.test(file.url)) {
      setObjectUrl(file.url);
      setMime('image/');
      return undefined;
    }
    let live = true;
    let created = null;
    setObjectUrl(null);
    setMime('');
    setFailed(false);
    api.get(file.url, { baseURL: '', responseType: 'blob' })
      .then((response) => {
        if (!live) return;
        created = URL.createObjectURL(response.data);
        setObjectUrl(created);
        setMime(String(response.data?.type || ''));
      })
      .catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [file]);

  useEffect(() => {
    if (!file) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [file, onClose]);

  if (!file) return null;
  const isPdf = mime === 'application/pdf';

  return (
    <div className="modal-overlay doc-viewer-overlay" onClick={onClose}>
      <div
        className="modal-content doc-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={file.name || 'Document'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-handle" />
        <div className="doc-viewer-head">
          <strong>{file.name || 'Document'}</strong>
          <button type="button" className="action-btn action-btn-gray" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="doc-viewer-body">
          {failed ? (
            <p className="doc-viewer-note">This file could not be loaded.</p>
          ) : !objectUrl ? (
            <p className="doc-viewer-note">Loading document…</p>
          ) : isPdf ? (
            <iframe src={objectUrl} title={file.name || 'Document'} className="doc-viewer-frame" />
          ) : (
            <img src={objectUrl} alt={file.name || 'Document'} className="doc-viewer-img" />
          )}
        </div>
        <p className="doc-viewer-hint">Scroll to see the whole photo · tap outside or press Esc to close</p>
      </div>
    </div>
  );
};

export default DocViewerModal;
