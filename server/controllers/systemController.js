import pool from '../config/db.js';
import { cleanupExpiredAttendanceImages } from '../utils/attendanceImageRetention.js';
import { writeAuditLog } from '../utils/audit.js';

export const getSystemHealth = async (_req, res) => {
  const started = Date.now();
  try {
    const [database, outbox, reports, files, events] = await Promise.all([
      pool.query('SELECT NOW() AS server_time'),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE status = 'dead')::int AS dead
        FROM notification_outbox`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE is_active AND last_error IS NOT NULL)::int AS failed
        FROM scheduled_reports`),
      pool.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(byte_size), 0)::bigint AS bytes FROM stored_files'),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE severity = 'error' AND created_at > NOW() - INTERVAL '24 hours')::int AS errors_24h,
        COUNT(*) FILTER (WHERE category = 'slow_request' AND created_at > NOW() - INTERVAL '24 hours')::int AS slow_24h
        FROM system_events`),
    ]);
    const notificationConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    const cloudStorageConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
    const queue = outbox.rows[0];
    const overall = queue.dead > 0 || reports.rows[0].failed > 0 ? 'attention' : 'healthy';
    return res.status(200).json({
      overall,
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - started,
      uptimeSeconds: Math.floor(process.uptime()),
      services: {
        database: { status: 'healthy', serverTime: database.rows[0].server_time },
        fileStorage: {
          status: 'healthy',
          backend: cloudStorageConfigured ? 'cloud' : 'encrypted database fallback',
          storedFiles: files.rows[0].count,
          storedBytes: Number(files.rows[0].bytes),
        },
        notifications: {
          status: notificationConfigured ? (queue.dead ? 'attention' : 'healthy') : 'not_configured',
          ...queue,
        },
        email: { status: emailConfigured ? 'healthy' : 'not_configured' },
        scheduledReports: {
          status: reports.rows[0].failed ? 'attention' : 'healthy',
          failed: reports.rows[0].failed,
        },
        operations: {
          status: events.rows[0].errors_24h ? 'attention' : 'healthy',
          errors24h: events.rows[0].errors_24h,
          slowRequests24h: events.rows[0].slow_24h,
        },
      },
    });
  } catch (error) {
    console.error('System health error:', error);
    return res.status(503).json({
      overall: 'unavailable',
      checkedAt: new Date().toISOString(),
      message: 'A required system dependency could not be checked.',
    });
  }
};

export const getOperationalEvents = async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  try {
    const result = await pool.query(`
      SELECT id, severity, category, message, method, path, status_code, duration_ms, created_at
      FROM system_events ORDER BY created_at DESC LIMIT $1
    `, [limit]);
    return res.status(200).json({ events: result.rows });
  } catch {
    return res.status(500).json({ message: 'Unable to load operational events.' });
  }
};

export const getBackupStatus = async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, file_name, byte_size, backup_created_at, verified_at, status, details
      FROM backup_verifications ORDER BY verified_at DESC LIMIT 10
    `);
    const latest = result.rows[0] || null;
    const stale = !latest || Date.now() - new Date(latest.verified_at).getTime() > 48 * 60 * 60 * 1000;
    return res.status(200).json({
      status: !latest ? 'never_verified' : stale ? 'stale' : latest.status,
      latest,
      history: result.rows,
      recommendation: stale ? 'Create and verify a backup now.' : null,
    });
  } catch {
    return res.status(500).json({ message: 'Unable to load backup verification status.' });
  }
};

export const getPrivacySettings = async (_req, res) => {
  try {
    const result = await pool.query("SELECT value, updated_at FROM system_settings WHERE key = 'attendance_privacy'");
    return res.status(200).json({
      settings: result.rows[0]?.value || { imageRetentionDays: 90 },
      updatedAt: result.rows[0]?.updated_at || null,
    });
  } catch {
    return res.status(500).json({ message: 'Unable to load privacy settings.' });
  }
};

export const updatePrivacySettings = async (req, res) => {
  const imageRetentionDays = Number(req.body.imageRetentionDays);
  if (!Number.isInteger(imageRetentionDays) || imageRetentionDays < 7 || imageRetentionDays > 730)
    return res.status(400).json({ message: 'Image retention must be between 7 and 730 days.' });
  try {
    const value = { imageRetentionDays };
    await pool.query(`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES ('attendance_privacy', $1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()
    `, [JSON.stringify(value), req.user.id]);
    await writeAuditLog({ actorId: req.user.id, action: 'privacy.attendance_update',
      entityType: 'system_setting', entityId: 'attendance_privacy', details: value, req });
    return res.status(200).json({ message: 'Attendance privacy settings updated.', settings: value });
  } catch {
    return res.status(500).json({ message: 'Unable to update privacy settings.' });
  }
};

export const runImageCleanup = async (req, res) => {
  try {
    const result = await cleanupExpiredAttendanceImages();
    await writeAuditLog({ actorId: req.user.id, action: 'privacy.attendance_cleanup_run',
      entityType: 'system_setting', entityId: 'attendance_privacy', details: result, req });
    return res.status(200).json({ message: `Cleanup completed. ${result.removed} image(s) removed.`, result });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to run image cleanup.' });
  }
};

const DEFAULT_ATTENDANCE_POLICY = {
  selfieRequired: true,
  maximumGpsAccuracyMeters: 100,
  unpaidBreakMinutes: 60,
  maximumCreditedHours: 8,
  offlineSubmissionHours: 24,
  correctionApprover: 'coordinator_or_admin',
};

export const getAttendancePolicy = async (_req, res) => {
  try {
    const result = await pool.query("SELECT value, updated_at FROM system_settings WHERE key = 'attendance_policy'");
    const policy = { ...DEFAULT_ATTENDANCE_POLICY, ...(result.rows[0]?.value || {}) };
    const meters = Number(policy.maximumGpsAccuracyMeters);
    policy.maximumGpsAccuracyMeters = Number.isFinite(meters) ? Math.max(100, meters) : 100;
    return res.status(200).json({ policy, updatedAt: result.rows[0]?.updated_at || null });
  } catch {
    return res.status(500).json({ message: 'Unable to load attendance policy.' });
  }
};

export const updateAttendancePolicy = async (req, res) => {
  const policy = {
    selfieRequired: Boolean(req.body.selfieRequired),
    maximumGpsAccuracyMeters: Number(req.body.maximumGpsAccuracyMeters),
    unpaidBreakMinutes: Number(req.body.unpaidBreakMinutes),
    maximumCreditedHours: Number(req.body.maximumCreditedHours),
    offlineSubmissionHours: Number(req.body.offlineSubmissionHours),
    correctionApprover: 'coordinator_or_admin',
  };
  if (!Number.isFinite(policy.maximumGpsAccuracyMeters) || policy.maximumGpsAccuracyMeters < 10 || policy.maximumGpsAccuracyMeters > 100
    || !Number.isInteger(policy.unpaidBreakMinutes) || policy.unpaidBreakMinutes < 0 || policy.unpaidBreakMinutes > 180
    || !Number.isFinite(policy.maximumCreditedHours) || policy.maximumCreditedHours < 1 || policy.maximumCreditedHours > 24
    || !Number.isInteger(policy.offlineSubmissionHours) || policy.offlineSubmissionHours < 1 || policy.offlineSubmissionHours > 168)
    return res.status(400).json({ message: 'Enter attendance-policy values within the allowed ranges.' });
  try {
    await pool.query(`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES ('attendance_policy', $1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = NOW()
    `, [JSON.stringify(policy), req.user.id]);
    await writeAuditLog({ actorId: req.user.id, action: 'attendance.policy_update',
      entityType: 'system_setting', entityId: 'attendance_policy', details: policy, req });
    return res.status(200).json({ message: 'Attendance policy updated.', policy });
  } catch {
    return res.status(500).json({ message: 'Unable to update attendance policy.' });
  }
};
