import pool from '../config/db.js';
import { IMAGE_TYPES, persistUpload } from '../utils/storage.js';

let fileId;
try {
  const owner = await pool.query("SELECT id FROM users WHERE role = 'student' ORDER BY created_at LIMIT 1");
  if (!owner.rows.length) throw new Error('No student account is available for the storage verification.');

  const fileUrl = await persistUpload(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    { folder: 'verification', ownerId: owner.rows[0].id, allowedTypes: IMAGE_TYPES, maxBytes: 1024 }
  );
  const token = fileUrl.split('/').pop();
  const [payload] = token.split('.');
  const location = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (location.backend !== 'database' || !location.fileId)
    throw new Error('Database fallback was not selected.');
  fileId = location.fileId;
  const stored = await pool.query('SELECT mime_type, byte_size FROM stored_files WHERE id = $1', [fileId]);
  if (stored.rows[0]?.mime_type !== 'image/png' || stored.rows[0]?.byte_size <= 0)
    throw new Error('Stored file metadata is invalid.');
  console.log('Database file storage verification passed.');
} finally {
  if (fileId) await pool.query('DELETE FROM stored_files WHERE id = $1', [fileId]);
  await pool.end();
}
