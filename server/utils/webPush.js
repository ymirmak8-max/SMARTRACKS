import webpush from 'web-push';
import pool from '../config/db.js';

const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com';
const configured = Boolean(publicKey && privateKey);

if (configured) webpush.setVapidDetails(subject, publicKey, privateKey);

export const getWebPushConfig = () => ({ configured, publicKey: configured ? publicKey : null });

export const savePushSubscription = async ({ userId, subscription, userAgent }) => {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw Object.assign(new Error('Invalid push subscription.'), { status: 400 });
  await pool.query(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      updated_at = NOW()
  `, [userId, endpoint, p256dh, auth, userAgent?.slice(0, 1000) || null]);
};

export const removePushSubscription = (userId, endpoint) => pool.query(
  'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]
);

export const sendWebPush = async (userId, notification) => {
  if (!configured) return { sent: 0, configured: false };
  const result = await pool.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId]
  );
  let sent = 0;
  for (const row of result.rows) {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      }, JSON.stringify({
        title: notification.title,
        body: notification.body,
        type: notification.type || 'general',
        url: notification.url || '/',
      }), { TTL: 60 * 60 * 24 });
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410)
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
      else console.warn('Web push delivery failed:', error.message);
    }
  }
  return { sent, configured: true };
};
