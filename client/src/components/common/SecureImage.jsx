import { useEffect, useState } from 'react';
import api from '../../api/axios';
import VectorIcon from './VectorIcon';

/**
 * Loads an image through the authenticated API client so protected
 * files (e.g. attendance selfies served from /api/files/...) work the
 * same as any other API call — plain <img> tags can't send the
 * Authorization header and silently break with a 401.
 */
const SecureImage = ({ src, alt = '', className = '', style }) => {
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) return undefined;
    // Public cloud URLs need no auth — load them directly.
    if (/^https?:\/\//i.test(src)) return undefined;
    let live = true;
    let url = null;
    setFailed(false);
    setObjectUrl(null);
    api.get(src, { baseURL: '', responseType: 'blob' })
      .then((response) => {
        if (!live) return;
        url = URL.createObjectURL(response.data);
        setObjectUrl(url);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src]);

  if (!src) return null;
  if (/^https?:\/\//i.test(src)) {
    return <img src={src} alt={alt} className={className} style={style} loading="lazy" />;
  }
  if (failed) {
    return (
      <span className="secure-img-failed" role="img" aria-label={`${alt} unavailable`}>
        <VectorIcon name="image" size={22} />
        <small>Photo unavailable</small>
      </span>
    );
  }
  if (!objectUrl) {
    return <span className="secure-img-loading" aria-label="Loading photo" />;
  }
  return <img src={objectUrl} alt={alt} className={className} style={style} loading="lazy" />;
};

export default SecureImage;
