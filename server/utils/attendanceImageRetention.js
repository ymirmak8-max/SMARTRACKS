import pool from '../config/db.js';
import { deleteStoredFile } from './storage.js';
import { writeAuditLog } from './audit.js';

let retentionTimer = null;

export const cleanupExpiredAttendanceImages = async () => {
  const setting = await pool.query("SELECT value FROM system_settings WHERE key = 'attendance_privacy'").catch(() => ({ rows: [] }));
  const retentionDays = Number.parseInt(
    setting.rows[0]?.value?.imageRetentionDays ?? process.env.ATTENDANCE_IMAGE_RETENTION_DAYS ?? '90',
    10
  );
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return { removed: 0, disabled: true };

  const expired = await pool.query(`
    SELECT tr.id, tr.selfie_in_url, tr.selfie_out_url
    FROM time_records tr
    JOIN deployments d ON d.id = tr.deployment_id
    WHERE d.end_date IS NOT NULL
      AND d.end_date < NOW() - ($1::int * INTERVAL '1 day')
      AND (tr.selfie_in_url IS NOT NULL OR tr.selfie_out_url IS NOT NULL)
    ORDER BY tr.id
    LIMIT 250
  `, [retentionDays]);

  let removed = 0;
  for (const record of expired.rows) {
    const cleared = [];
    for (const [column, url] of [['selfie_in_url', record.selfie_in_url], ['selfie_out_url', record.selfie_out_url]]) {
      if (!url) continue;
      try {
        await deleteStoredFile(url);
        cleared.push(column);
        removed += 1;
      } catch (error) {
        console.error(`Attendance image retention failed for record ${record.id}:`, error.message);
      }
    }
    if (cleared.length) {
      await pool.query(`UPDATE time_records SET
        selfie_in_url = CASE WHEN $2::boolean THEN NULL ELSE selfie_in_url END,
        selfie_out_url = CASE WHEN $3::boolean THEN NULL ELSE selfie_out_url END
        WHERE id = $1`, [record.id, cleared.includes('selfie_in_url'), cleared.includes('selfie_out_url')]);
    }
  }
  if (removed) await writeAuditLog({ action: 'attendance.selfie_retention_cleanup', entityType: 'time_record', details: { removed, retentionDays } });
  return { removed, retentionDays };
};

export const startAttendanceImageRetention = () => {
  if (retentionTimer) return retentionTimer;
  cleanupExpiredAttendanceImages().catch(error => console.error('Attendance image retention error:', error.message));
  retentionTimer = setInterval(() => {
    cleanupExpiredAttendanceImages().catch(error => console.error('Attendance image retention error:', error.message));
  }, 24 * 60 * 60 * 1000);
  retentionTimer.unref?.();
  return retentionTimer;
};

export const stopAttendanceImageRetention = () => {
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
};
