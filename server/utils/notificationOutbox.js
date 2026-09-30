import pool from '../config/db.js';

const MAX_ATTEMPTS = 8;
const BATCH_SIZE = 20;
let timer = null;
let running = false;

export const enqueueNotification = async (userId, title, body, type = 'general') => {
  if (!userId || !title || !body) throw new Error('Invalid notification payload.');
  const result = await pool.query(`
    INSERT INTO notification_outbox (user_id, title, body, type)
    VALUES ($1, $2, $3, $4)
    RETURNING id, status, created_at
  `, [userId, title, body, type]);
  return result.rows[0];
};

const claimBatch = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE notification_outbox outbox
      SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
      WHERE outbox.id IN (
        SELECT id FROM notification_outbox
        WHERE attempts < $1
          AND next_attempt_at <= NOW()
          AND (status IN ('pending', 'failed') OR (status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'))
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      RETURNING outbox.*
    `, [MAX_ATTEMPTS, BATCH_SIZE]);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const markDelivered = (id) => pool.query(`
  UPDATE notification_outbox
  SET status = 'delivered', delivered_at = NOW(), last_error = NULL, updated_at = NOW()
  WHERE id = $1
`, [id]);

const markSuppressed = (id, reason) => pool.query(`
  UPDATE notification_outbox
  SET status = 'suppressed', last_error = $2, updated_at = NOW()
  WHERE id = $1
`, [id, reason]);

const deferUntil = (id, nextAttemptAt) => pool.query(`
  UPDATE notification_outbox
  SET status = 'pending', attempts = GREATEST(0, attempts - 1),
      next_attempt_at = $2, updated_at = NOW()
  WHERE id = $1
`, [id, nextAttemptAt]);

const preferenceCategory = type => {
  if (/attendance|clock|dtr/i.test(type)) return 'attendance';
  if (/document|upload/i.test(type)) return 'documents';
  if (/announcement/i.test(type)) return 'announcements';
  return null;
};

const deliveryDecision = async job => {
  const result = await pool.query('SELECT notification_preferences FROM users WHERE id = $1 AND is_active = true', [job.user_id]);
  if (!result.rows.length) return { suppress: 'Recipient account is inactive.' };
  const preferences = result.rows[0].notification_preferences || {};
  if (preferences.inApp === false) return { suppress: 'In-app notifications are disabled by the recipient.' };
  const category = preferenceCategory(job.type);
  if (category && preferences[category] === false)
    return { suppress: `${category} notifications are disabled by the recipient.` };

  const start = preferences.quietHoursStart;
  const end = preferences.quietHoursEnd;
  if (!start || !end || start === end) return {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const nowMinutes = Number(values.hour) * 60 + Number(values.minute);
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const quiet = startMinutes < endMinutes
    ? nowMinutes >= startMinutes && nowMinutes < endMinutes
    : nowMinutes >= startMinutes || nowMinutes < endMinutes;
  if (!quiet) return {};
  const waitMinutes = (endMinutes - nowMinutes + 24 * 60) % (24 * 60) || 24 * 60;
  return { deferUntil: new Date(Date.now() + waitMinutes * 60_000) };
};

const markFailed = (job, error) => {
  const delaySeconds = Math.min(3600, 15 * (2 ** Math.max(0, job.attempts - 1)));
  return pool.query(`
    UPDATE notification_outbox
    SET status = CASE WHEN attempts >= $2 THEN 'dead' ELSE 'failed' END,
        last_error = $3,
        next_attempt_at = NOW() + ($4 * INTERVAL '1 second'),
        updated_at = NOW()
    WHERE id = $1
  `, [job.id, MAX_ATTEMPTS, String(error?.message || error).slice(0, 2000), delaySeconds]);
};

export const processNotificationOutbox = async (deliver) => {
  if (running) return 0;
  running = true;
  try {
    const jobs = await claimBatch();
    for (const job of jobs) {
      try {
        const decision = await deliveryDecision(job);
        if (decision.suppress) {
          await markSuppressed(job.id, decision.suppress);
          continue;
        }
        if (decision.deferUntil) {
          await deferUntil(job.id, decision.deferUntil);
          continue;
        }
        await deliver(job);
        await markDelivered(job.id);
      } catch (error) {
        await markFailed(job, error);
      }
    }
    return jobs.length;
  } finally {
    running = false;
  }
};

export const startNotificationWorker = (deliver, intervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS || 5000)) => {
  if (timer) return;
  const run = () => processNotificationOutbox(deliver)
    .catch(error => console.error('Notification outbox worker error:', error.message));
  run();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
};

export const stopNotificationWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
