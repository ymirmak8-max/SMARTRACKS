import pool from '../config/db.js';
import { IMAGE_TYPES, persistUpload } from '../utils/storage.js';

const invalid = await pool.query(`
  UPDATE time_records
  SET selfie_in_url = CASE WHEN selfie_in_url = 'data:,' THEN NULL ELSE selfie_in_url END,
      selfie_out_url = CASE WHEN selfie_out_url = 'data:,' THEN NULL ELSE selfie_out_url END
  WHERE selfie_in_url = 'data:,' OR selfie_out_url = 'data:,'
  RETURNING id
`);

const records = await pool.query(`
  SELECT id, student_id, selfie_in_url, selfie_out_url
  FROM time_records
  WHERE selfie_in_url LIKE 'data:%' OR selfie_out_url LIKE 'data:%'
  ORDER BY id
`);

let migrated = 0;
let failed = 0;
for (const record of records.rows) {
  for (const column of ['selfie_in_url', 'selfie_out_url']) {
    const value = record[column];
    if (!value?.startsWith('data:')) continue;
    try {
      const storedUrl = await persistUpload(value, {
        folder: 'attendance/selfies',
        ownerId: record.student_id,
        allowedTypes: IMAGE_TYPES,
        maxBytes: 3 * 1024 * 1024,
      });
      await pool.query(`UPDATE time_records SET ${column} = $1 WHERE id = $2`, [storedUrl, record.id]);
      migrated += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed to migrate ${column} for time record ${record.id}:`, error.message);
    }
  }
}

console.log(`Legacy selfie migration completed: ${migrated} migrated, ${failed} failed, ${invalid.rowCount} invalid placeholders removed.`);
await pool.end();
