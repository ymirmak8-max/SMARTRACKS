import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';
import { enqueueNotification, processNotificationOutbox } from '../utils/notificationOutbox.js';
import { getWebPushConfig, removePushSubscription, savePushSubscription, sendWebPush } from '../utils/webPush.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const requireNotificationConfig = () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.');
};
const notificationConfigAvailable = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabaseHeaders = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Prefer': 'return=representation',
};

// GET /api/notifications
export const getNotifications = async (req, res) => {
  try {
    if (!notificationConfigAvailable)
      return res.status(200).json({ notifications: [], realtime: false });
    requireNotificationConfig();
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${req.user.id}&order=created_at.desc&limit=20`,
      { headers: supabaseHeaders }
    );
    if (!response.ok) {
      console.warn(`Notification service unavailable (${response.status}); returning an empty notification list.`);
      return res.status(200).json({ notifications: [], realtime: false });
    }
    const data = await response.json();
    return res.status(200).json({ notifications: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.warn('Notification service unavailable; returning an empty notification list:', err.message);
    return res.status(200).json({ notifications: [], realtime: false });
  }
};

// PATCH /api/notifications/:id/read
export const markAsRead = async (req, res) => {
  try {
    requireNotificationConfig();
    const { id } = req.params;
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?id=eq.${encodeURIComponent(id)}&user_id=eq.${req.user.id}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({ is_read: true }),
      }
    );
    if (!response.ok)
      return res.status(502).json({ message: 'Notification service rejected the update.' });
    return res.status(200).json({ message: 'Marked as read.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to mark as read.' });
  }
};

// PATCH /api/notifications/read-all
export const markAllAsRead = async (req, res) => {
  try {
    requireNotificationConfig();
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${req.user.id}&is_read=eq.false`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({ is_read: true }),
      }
    );
    if (!response.ok)
      return res.status(502).json({ message: 'Notification service rejected the update.' });
    return res.status(200).json({ message: 'All marked as read.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to mark all as read.' });
  }
};

// POST /api/notifications
export const createNotification = async (req, res) => {
  try {
    const { userId, title, body, type } = req.body;
    if (!userId || !title || !body)
      return res.status(400).json({ message: 'User, title, and body are required.' });
    await sendNotification(userId, title, body, type);
    return res.status(202).json({ message: 'Notification queued for delivery.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create notification.' });
  }
};

// Helper — used by other controllers
export const deliverNotification = async ({ user_id: userId, title, body, type = 'general' }) => {
  const deliverInApp = async () => {
    if (!notificationConfigAvailable) return false;
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications`,
      {
        method: 'POST',
        headers: supabaseHeaders,
        body: JSON.stringify({ user_id: userId, title, body, type }),
      }
    );
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Notification service error (${response.status}): ${details}`);
    }
    return true;
  };
  const [inAppResult, pushResult] = await Promise.allSettled([
    deliverInApp(),
    sendWebPush(userId, { title, body, type, url: '/' }),
  ]);
  const inAppDelivered = inAppResult.status === 'fulfilled' && inAppResult.value;
  const push = pushResult.status === 'fulfilled' ? pushResult.value : { configured: false, sent: 0 };
  if (!inAppDelivered && (!push.configured || push.sent === 0)) {
    const errors = [
      inAppResult.status === 'rejected' ? inAppResult.reason?.message : null,
      pushResult.status === 'rejected' ? pushResult.reason?.message : null,
    ].filter(Boolean).join(' | ');
    throw new Error(errors || 'No in-app notification service or subscribed device is available for this recipient.');
  }
};

export const getPushPublicConfig = (_req, res) => res.status(200).json(getWebPushConfig());

export const subscribePush = async (req, res) => {
  try {
    if (!getWebPushConfig().configured)
      return res.status(503).json({ message: 'Device alerts are not configured.' });
    await savePushSubscription({ userId: req.user.id, subscription: req.body, userAgent: req.get('user-agent') });
    return res.status(201).json({ message: 'Device alerts enabled.' });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to enable device alerts.' });
  }
};

export const unsubscribePush = async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ message: 'Subscription endpoint is required.' });
  try {
    await removePushSubscription(req.user.id, endpoint);
    return res.status(200).json({ message: 'Device alerts disabled.' });
  } catch {
    return res.status(500).json({ message: 'Failed to disable device alerts.' });
  }
};

export const getOutboxStatus = async (_req, res) => {
  try {
    const [counts, failures] = await Promise.all([
      pool.query('SELECT status, COUNT(*)::int AS count FROM notification_outbox GROUP BY status'),
      pool.query(`SELECT id, user_id, title, type, status, attempts, last_error, next_attempt_at, created_at
                  FROM notification_outbox WHERE status IN ('failed', 'dead')
                  ORDER BY updated_at DESC LIMIT 50`),
    ]);
    return res.status(200).json({ counts: counts.rows, failures: failures.rows });
  } catch {
    return res.status(500).json({ message: 'Failed to load notification outbox.' });
  }
};

export const retryOutboxNotification = async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE notification_outbox
      SET status = 'pending', attempts = 0, next_attempt_at = NOW(), last_error = NULL, updated_at = NOW()
      WHERE id = $1 AND status IN ('failed', 'dead') RETURNING id
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Failed notification not found.' });
    await writeAuditLog({ actorId: req.user.id, action: 'notification.retry', entityType: 'notification_outbox',
      entityId: req.params.id, req });
    return res.status(202).json({ message: 'Notification queued for retry.' });
  } catch {
    return res.status(500).json({ message: 'Failed to retry notification.' });
  }
};

const DEFAULT_PREFERENCES = {
  inApp: true,
  email: true,
  attendance: true,
  documents: true,
  announcements: true,
  quietHoursStart: null,
  quietHoursEnd: null,
};

export const getNotificationPreferences = async (req, res) => {
  try {
    const result = await pool.query('SELECT notification_preferences FROM users WHERE id = $1', [req.user.id]);
    return res.status(200).json({ preferences: { ...DEFAULT_PREFERENCES, ...(result.rows[0]?.notification_preferences || {}) } });
  } catch (error) {
    console.error('Get notification preferences error:', error);
    return res.status(500).json({ message: 'Failed to load notification preferences.' });
  }
};

export const updateNotificationPreferences = async (req, res) => {
  const input = req.body || {};
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const quietHoursStart = input.quietHoursStart || null;
  const quietHoursEnd = input.quietHoursEnd || null;
  if ((quietHoursStart && !timePattern.test(quietHoursStart)) || (quietHoursEnd && !timePattern.test(quietHoursEnd)))
    return res.status(400).json({ message: 'Quiet hours must use HH:MM format.' });
  const preferences = {
    inApp: input.inApp !== false,
    email: input.email !== false,
    attendance: input.attendance !== false,
    documents: input.documents !== false,
    announcements: input.announcements !== false,
    quietHoursStart,
    quietHoursEnd,
  };
  try {
    await pool.query('UPDATE users SET notification_preferences = $1 WHERE id = $2',
      [JSON.stringify(preferences), req.user.id]);
    await writeAuditLog({ actorId: req.user.id, action: 'notification.preferences_update',
      entityType: 'user', entityId: req.user.id, details: preferences, req });
    return res.status(200).json({ message: 'Notification preferences updated.', preferences });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    return res.status(500).json({ message: 'Failed to update notification preferences.' });
  }
};

// Callers enqueue locally; the worker retries remote delivery independently.
// On Vercel there is no in-process interval, so drain the outbox in-request.
export const sendNotification = async (userId, title, body, type = 'general') => {
  const job = await enqueueNotification(userId, title, body, type);
  if (process.env.VERCEL) {
    await processNotificationOutbox(deliverNotification).catch(error =>
      console.error('Notification outbox drain failed:', error.message)
    );
  }
  return job;
};
