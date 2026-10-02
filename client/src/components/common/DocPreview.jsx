import { useEffect, useState } from 'react';
import api from '../../api/axios';

/* Thumbnail preview for a submitted document file. Only image files
   render a photo; anything else (e.g. PDF) renders nothing so the
   row falls back to its View link. */
const DocPreview = ({ url, name, onOpen }) => {
  const [objectUrl, setObjectUrl] = useState(null);
  const [checked, setChecked] = useState(/^https?:\/\//i.test(url || ''));
  const [isImage, setIsImage] = useState(false);

  useEffect(() => {
    if (!url || /^https?:\/\//i.test(url)) return undefined;
    let live = true;
    let created = null;
    api.get(url, { baseURL: '', responseType: 'blob' })
      .then((response) => {
        if (!live) return;
        if (String(response.data?.type || '').startsWith('image/')) {
          created = URL.createObjectURL(response.data);
          setObjectUrl(created);
          setIsImage(true);
        }
        setChecked(true);
      })
      .catch(() => { if (live) setChecked(true); });
    return () => {
      live = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    return (
      <button type="button" className="doc-thumb" onClick={onOpen} aria-label={`View ${name}`}>
        <img src={url} alt="" loading="lazy" />
      </button>
    );
  }
  if (!checked) return <span className="doc-thumb is-loading" aria-label="Loading preview" />;
  if (!isImage || !objectUrl) return null;
  return (
    <button type="button" className="doc-thumb" onClick={onOpen} aria-label={`View ${name}`}>
      <img src={objectUrl} alt="" loading="lazy" />
    </button>
  );
};

export default DocPreview;
