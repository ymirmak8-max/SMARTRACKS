import { useEffect, useRef, useState } from 'react';
import { uploadProfilePicture, removeProfilePicture } from '../../api/profile';
import api from '../../api/axios';
import useAuth from '../../hooks/useAuth';

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

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

const UserAvatar = ({ src, initials, size = 64, className = '' }) => {
  const [displaySrc, setDisplaySrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    setFailed(false);
    setDisplaySrc(null);
    if (!src) return undefined;

    const load = async () => {
      const path = fileApiPath(src);
      if (!path) return;
      if (path.startsWith('data:') || path.startsWith('blob:') || /^https?:\/\//i.test(path)) {
        if (!cancelled) setDisplaySrc(path);
        return;
      }
      try {
        const response = await api.get(path, { responseType: 'blob' });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(response.data);
        setDisplaySrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  const showImage = displaySrc && !failed;
  return (
    <div className={`profile-avatar ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      {showImage ? (
        <img src={displaySrc} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>{initials || '?'}</span>
      )}
    </div>
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
    const namedImage = /\.(jpe?g|png)$/i.test(file.name || '');
    if (!ALLOWED_TYPES.includes(file.type) && !(file.type === '' && namedImage))
      return onToast?.('Use a JPG or PNG photo.', 'error');
    if (file.size > MAX_BYTES)
      return onToast?.('Photo must be smaller than 2 MB.', 'error');
    setBusy(true);
    try {
      const image = await readAsDataUrl(file);
      const response = await uploadProfilePicture(image);
      applyPicture(response.data.profilePicture || response.data.profile_picture);
      onToast?.('Profile photo updated.');
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The photo could not be uploaded.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await removeProfilePicture();
      applyPicture(null);
      onToast?.('Profile photo removed.');
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The photo could not be removed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-avatar-editor">
      <UserAvatar src={picture} initials={initials} size={size} />
      <div className="profile-avatar-actions">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
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
