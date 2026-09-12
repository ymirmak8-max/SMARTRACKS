import { clockIn, clockOut } from '../api/dtr';

const DB_NAME = 'smartrack-offline';
const STORE = 'attendance-submissions';
const EVENT = 'smartrack:attendance-queue';

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE))
      db.createObjectStore(STORE, { keyPath: 'submissionId' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transaction = async (mode, operation) => {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
};
const announce = () => window.dispatchEvent(new Event(EVENT));
const save = item => transaction('readwrite', store => store.put(item));
const remove = id => transaction('readwrite', store => store.delete(id));

export const queueAttendance = async (action, payload) => {
  const item = { ...payload, action, status: 'pending', attempts: 0, lastError: null, queuedAt: new Date().toISOString() };
  await save(item); announce();
  return item;
};
export const getAttendanceQueue = () => transaction('readonly', store => store.getAll());
export const getAttendanceQueueSummary = async () => {
  const items = await getAttendanceQueue();
  return {
    total: items.length,
    pending: items.filter(item => ['pending', 'syncing'].includes(item.status)).length,
    failed: items.filter(item => item.status === 'failed').length,
  };
};
export const synchronizeAttendanceQueue = async () => {
  if (!navigator.onLine) return getAttendanceQueueSummary();
  const items = (await getAttendanceQueue()).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  for (const item of items) {
    const syncing = { ...item, status: 'syncing', attempts: item.attempts + 1, lastError: null };
    await save(syncing); announce();
    try {
      const payload = { ...syncing };
      ['action', 'status', 'attempts', 'lastError', 'queuedAt'].forEach(key => delete payload[key]);
      if (syncing.action === 'in') await clockIn(payload);
      else await clockOut(payload);
      await remove(item.submissionId);
    } catch (error) {
      const networkFailure = !error.response;
      await save({ ...syncing, status: networkFailure ? 'pending' : 'failed',
        lastError: error.response?.data?.message || 'Waiting for a network connection.' });
      announce();
      if (networkFailure) break;
    }
  }
  announce();
  return getAttendanceQueueSummary();
};
export const retryFailedAttendance = async () => {
  const items = await getAttendanceQueue();
  await Promise.all(items.filter(item => item.status === 'failed')
    .map(item => save({ ...item, status: 'pending', lastError: null })));
  announce();
  return synchronizeAttendanceQueue();
};
export const subscribeAttendanceQueue = callback => {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
};
