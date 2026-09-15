import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { uploadProfilePicture, removeProfilePicture } from '../../api/profile';
import api from '../../api/axios';
import useAuth from '../../hooks/useAuth';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 720;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const blobUrlCache = new Map();

const fileApiPath = (src) => {
  if (!src) return null;
  if (src.startsWith('data:') || src.startsWith('blob:') || /^https?:\/\//i.test(src)) return src;
  if (src.includes('/files/')) return `/files/${src.split('/files/').pop()}`;
  return src.startsWith('/api/') ? src.slice(4) : src;
};

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('The photo could not be read.'));
  reader.readAsDataURL(file);
});

const compressPhoto = async (file) => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/jpeg')) return dataUrl;
  } catch {
    /* Fall through to the original file when the browser cannot decode HEIC/WEBP. */
  }
  return readAsDataUrl(file);
};

const resolveAvatarSrc = async (src) => {
  const path = fileApiPath(src);
  if (!path) return null;
  if (path.startsWith('data:') || path.startsWith('blob:') || /^https?:\/\//i.test(path)) return path;
  if (blobUrlCache.has(path)) return blobUrlCache.get(path);
  const response = await api.get(path, { responseType: 'blob' });
  const objectUrl = URL.createObjectURL(response.data);
  blobUrlCache.set(path, objectUrl);
  return objectUrl;
};

const UserAvatar = ({ src, initials, size = 64, className = '', previewable = false }) => {
  const [displaySrc, setDisplaySrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!src) {
      setDisplaySrc(null);
      return undefined;
    }

    const load = async () => {
      try {
        const next = await resolveAvatarSrc(src);
        if (!cancelled && next) setDisplaySrc(next);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [src]);

  useEffect(() => {
    if (!previewOpen) return undefined;
    const close = (event) => {
      if (event.key === 'Escape') setPreviewOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [previewOpen]);

  const showImage = displaySrc && !failed;
  const openPreview = () => {
    if (previewable && showImage) setPreviewOpen(true);
  };

  return (
    <>
      {previewable && showImage ? (
        <button
          type="button"
          className={`profile-avatar profile-avatar-preview ${className}`.trim()}
          style={{ width: size, height: size }}
          onClick={openPreview}
          aria-label="View full profile photo"
        >
          <img src={displaySrc} alt="" onError={() => setFailed(true)} />
        </button>
      ) : (
        <div className={`profile-avatar ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
          {showImage ? (
            <img src={displaySrc} alt="" onError={() => setFailed(true)} />
          ) : (
            <span>{initials || '?'}</span>
          )}
        </div>
      )}
      {previewOpen && showImage && createPortal(
        <div
          className="modal-overlay profile-photo-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}
        >
          <div className="modal-content profile-photo-modal" role="dialog" aria-modal="true" aria-label="Profile photo">
            <div className="profile-photo-header">
              <h2 className="modal-title">Profile photo</h2>
              <button type="button" className="action-btn action-btn-gray" onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
            <img className="profile-photo-full" src={displaySrc} alt="Full profile photo" />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

const ProfileAvatar = ({ initials, size = 64, onToast }) => {
  const { user, patchUser } = useAuth();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const picture = user?.profilePicture || user?.profile_picture;

  const applyPicture = (next) => {
    patchUser?.({ profilePicture: next, profile_picture: next });
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const namedImage = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
    if (!ALLOWED_TYPES.includes(file.type) && !(file.type === '' && namedImage))
      return onToast?.('Use a JPG, PNG, or WEBP photo.', 'error');
    if (file.size > MAX_BYTES)
      return onToast?.('Photo must be smaller than 2 MB.', 'error');
    const previous = picture;
    setBusy(true);
    try {
      const image = await compressPhoto(file);
      applyPicture(image);
      const response = await uploadProfilePicture(image);
      applyPicture(response.data.profilePicture || response.data.profile_picture);
      onToast?.('Profile photo updated.');
    } catch (error) {
      applyPicture(previous || null);
      onToast?.(error.response?.data?.message || 'The photo could not be uploaded.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    const previous = picture;
    applyPicture(null);
    setBusy(true);
    try {
      await removeProfilePicture();
      onToast?.('Profile photo removed.');
    } catch (error) {
      applyPicture(previous || null);
      onToast?.(error.response?.data?.message || 'The photo could not be removed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-avatar-editor">
      <UserAvatar src={picture} initials={initials} size={size} previewable />
      <div className="profile-avatar-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic"
          hidden
          onChange={handleFile}
        />
        <button type="button" className="action-btn action-btn-primary" disabled={busy}
          onClick={() => inputRef.current?.click()}>
          {busy ? 'Saving…' : picture ? 'Change photo' : 'Upload photo'}
        </button>
        {picture && (
          <button type="button" className="action-btn action-btn-gray" disabled={busy} onClick={handleRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
};

export { UserAvatar };
export default ProfileAvatar;
