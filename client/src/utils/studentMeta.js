/**
 * Student academic meta (year level + section), stored on this device.
 * Keyed by user id so multiple accounts on one device don't clash.
 */

const META_EVENT = 'smartrack:student-meta';

const keyFor = (userId) => `smartrack:studentMeta:${userId || 'anon'}`;

export const getStudentMeta = (userId) => {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return { yearLevel: '', section: '' };
    const parsed = JSON.parse(raw);
    return {
      yearLevel: String(parsed?.yearLevel || ''),
      section: String(parsed?.section || ''),
    };
  } catch {
    return { yearLevel: '', section: '' };
  }
};

export const saveStudentMeta = (userId, { yearLevel = '', section = '' } = {}) => {
  const meta = { yearLevel: String(yearLevel || ''), section: String(section || '') };
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(meta));
  } catch { /* Private mode can block storage. */ }
  window.dispatchEvent(new CustomEvent(META_EVENT, { detail: { userId, meta } }));
  return meta;
};

/** "2nd Year · BSIT-3A" style line, or empty string when nothing is set. */
export const formatStudentMeta = (meta) => {
  const parts = [meta?.yearLevel, meta?.section].map(part => String(part || '').trim()).filter(Boolean);
  return parts.join(' · ');
};

export const subscribeStudentMeta = (callback) => {
  const handler = (event) => callback(event.detail);
  window.addEventListener(META_EVENT, handler);
  return () => window.removeEventListener(META_EVENT, handler);
};
