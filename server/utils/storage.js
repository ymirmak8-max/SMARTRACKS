import crypto from 'node:crypto';
import sharp from 'sharp';
import { scanForMalware } from './malwareScanner.js';

// Existing Supabase bucket. Changing this string without renaming the bucket breaks file access.
const DEFAULT_STORAGE_BUCKET = 'trackpoint-files';

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'jpg',
  'image/heic': 'jpg', 'image/heif': 'jpg', 'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const IMAGE_TYPES = ['image/jpeg', 'image/png'];
export const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
export const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const PHOTO_TYPES = PROFILE_IMAGE_TYPES;
const GENERIC_IMAGE_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'image']);

const parseDataUrl = (value) => {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]+)$/i.exec(value || '');
  if (!match) throw Object.assign(new Error('The uploaded file is invalid.'), { status: 400 });
  const encoded = match[2].replace(/\s/g, '');
  if (!encoded || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded))
    throw Object.assign(new Error('The uploaded file is invalid.'), { status: 400 });
  const declared = (match[1] || '').toLowerCase();
  const mime = declared === 'image/jpg' || declared === 'image/pjpeg' ? 'image/jpeg'
    : declared === 'image/x-png' ? 'image/png'
      : declared;
  return { mime, buffer: Buffer.from(encoded, 'base64') };
};

const storageHeaders = (serviceKey, json = false) => ({
  Authorization: `Bearer ${serviceKey}`,
  apikey: serviceKey,
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

let bucketReady = null;
const ensureStorageBucket = async (supabaseUrl, serviceKey, bucket) => {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const existing = await fetch(`${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      headers: storageHeaders(serviceKey),
    });
    const mimeList = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (existing.ok) {
      await fetch(`${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
        method: 'PUT',
        headers: storageHeaders(serviceKey, true),
        body: JSON.stringify({ file_size_limit: 10 * 1024 * 1024, allowed_mime_types: mimeList }),
      }).catch(() => {});
      return;
    }
    const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: storageHeaders(serviceKey, true),
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: false,
        file_size_limit: 10 * 1024 * 1024,
        allowed_mime_types: mimeList,
      }),
    });
    if (!created.ok && created.status !== 409) {
      const detail = await created.text().catch(() => '');
      console.error('Unable to create storage bucket:', created.status, detail);
      throw new Error('File storage is not ready.');
    }
  })().catch((error) => {
    bucketReady = null;
    throw error;
  });
  return bucketReady;
};

const hasExpectedSignature = (mime, buffer) => {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return looksLikeWebp(buffer);
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'application/msword')
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return false;
};

const looksLikeWebp = (buffer) =>
  buffer.length >= 12
  && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
  && buffer.subarray(8, 12).toString('ascii') === 'WEBP';

const looksLikeHeic = (buffer) => {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  return /heic|heif|mif1|msf1|heix|hevc/i.test(buffer.subarray(8, 12).toString('ascii'));
};

const sniffImageMime = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (looksLikeWebp(buffer)) return 'image/webp';
  if (looksLikeHeic(buffer)) return 'image/heic';
  return null;
};

const sanitizeImage = async (buffer) => {
  try {
    const image = sharp(buffer, {
      failOn: 'none',
      limitInputPixels: 25_000_000,
      sequentialRead: true,
    }).rotate().resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height)
      throw new Error('Unexpected decoded image format.');
    return image.jpeg({ quality: 82, chromaSubsampling: '4:2:0' }).toBuffer();
  } catch (error) {
    throw Object.assign(new Error('The image could not be decoded safely.'), { status: 415, cause: error });
  }
};

let filesTableReady = null;
const ensureStoredFilesTable = async (pool) => {
  filesTableReady ||= pool.query(`
    CREATE TABLE IF NOT EXISTS stored_files (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime_type VARCHAR(100) NOT NULL,
      content BYTEA NOT NULL,
      byte_size INT NOT NULL CHECK (byte_size > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => pool.query(
    'CREATE INDEX IF NOT EXISTS stored_files_owner_created_idx ON stored_files (owner_id, created_at DESC)'
  )).catch((error) => {
    filesTableReady = null;
    throw error;
  });
  await filesTableReady;
};

const contentToBuffer = (content) => {
  if (Buffer.isBuffer(content)) return content;
  if (content?.type === 'Buffer' && Array.isArray(content.data)) return Buffer.from(content.data);
  if (typeof content === 'string') {
    if (/^\\x/i.test(content)) return Buffer.from(content.slice(2), 'hex');
    return Buffer.from(content, 'base64');
  }
  if (content?.__bytea) return Buffer.from(content.__bytea, 'base64');
  throw Object.assign(new Error('File not found.'), { status: 404 });
};

const createFileToken = (location) => {
  const payload = Buffer.from(JSON.stringify(location)).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url');
  return `/api/files/${payload}.${signature}`;
};

const decodeFileToken = (token) => {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) throw Object.assign(new Error('Invalid file link.'), { status: 404 });
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET).update(payload).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right))
    throw Object.assign(new Error('Invalid file link.'), { status: 404 });
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid file link.'), { status: 404 }); }
};

export const persistUpload = async (value, { folder, ownerId, allowedTypes, maxBytes }) => {
  if (!value) return null;
  if (/^https:\/\//i.test(value)) {
    const storageHost = process.env.SUPABASE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (storageHost && new URL(value).host === storageHost) return value;
    throw Object.assign(new Error('External file links are not allowed.'), { status: 400 });
  }
  const parsed = parseDataUrl(value);
  let { mime, buffer } = parsed;
  if (GENERIC_IMAGE_MIMES.has(mime)) mime = sniffImageMime(buffer) || mime;
  if (mime === 'image/jpg' || mime === 'image/pjpeg') mime = 'image/jpeg';
  if (mime === 'image/x-png') mime = 'image/png';
  if (!allowedTypes.includes(mime)) throw Object.assign(new Error('This file type is not allowed.'), { status: 415 });
  if (!buffer.length || buffer.length > maxBytes)
    throw Object.assign(new Error(`File must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`), { status: 413 });
  const skipMagicCheck = mime === 'image/heic' || mime === 'image/heif' || looksLikeHeic(buffer);
  if (!skipMagicCheck && !hasExpectedSignature(mime, buffer) && !sniffImageMime(buffer))
    throw Object.assign(new Error('The file contents do not match the declared file type.'), { status: 415 });
  if (PHOTO_TYPES.includes(mime) || sniffImageMime(buffer)) {
    try {
      buffer = await sanitizeImage(buffer);
      mime = 'image/jpeg';
    } catch (error) {
      if (mime === 'image/jpeg' && hasExpectedSignature('image/jpeg', buffer)) {
        /* Keep the original JPEG when sharp cannot re-encode this phone photo. */
      } else {
        throw error;
      }
    }
    if (buffer.length > maxBytes)
      throw Object.assign(new Error(`File must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`), { status: 413 });
  } else {
    await scanForMalware(buffer, MIME_EXTENSIONS[mime] || 'bin');
  }

  const storeInDatabase = async () => {
    const { default: pool } = await import('../config/db.js');
    await ensureStoredFilesTable(pool);
    const stored = await pool.query(
      `INSERT INTO stored_files (owner_id, mime_type, content, byte_size)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [ownerId, mime, buffer, buffer.length]
    );
    if (!stored.rows[0]?.id) throw Object.assign(new Error('The photo could not be stored.'), { status: 500 });
    return createFileToken({ backend: 'database', fileId: stored.rows[0].id });
  };

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET;
  if (!supabaseUrl || !serviceKey) return storeInDatabase();
  try { await ensureStorageBucket(supabaseUrl, serviceKey, bucket); }
  catch (error) { console.error('Storage bucket check failed:', error.message); }
  const objectPath = `${folder}/${ownerId}/${Date.now()}-${crypto.randomUUID()}.${MIME_EXTENSIONS[mime] || 'jpg'}`;
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: 'POST',
    headers: { ...storageHeaders(serviceKey), 'Content-Type': mime, 'x-upsert': 'true' },
    body: buffer,
  });
  if (!response.ok) {
    console.error('Cloud storage upload failed:', response.status, await response.text().catch(() => ''));
    return storeInDatabase();
  }
  return createFileToken({ backend: 'supabase', bucket, objectPath });
};

export const streamStoredFile = async (token, res) => {
  const location = decodeFileToken(token);
  if (location.backend === 'database') {
    const { default: pool } = await import('../config/db.js');
    const stored = await pool.query(
      'SELECT mime_type, encode(content, \'base64\') AS content FROM stored_files WHERE id = $1',
      [location.fileId]
    );
    if (!stored.rows.length) throw Object.assign(new Error('File not found.'), { status: 404 });
    res.setHeader('Content-Type', stored.rows[0].mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(contentToBuffer(stored.rows[0].content));
  }
  if (!location.bucket || !location.objectPath)
    throw Object.assign(new Error('Invalid file link.'), { status: 404 });
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey)
    throw Object.assign(new Error('Cloud file storage is unavailable.'), { status: 503 });
  const encodedPath = String(location.objectPath).split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(location.bucket)}/${encodedPath}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!response.ok) throw Object.assign(new Error('File not found.'), { status: response.status === 404 ? 404 : 502 });
  res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(Buffer.from(await response.arrayBuffer()));
};

export const deleteStoredFile = async (fileUrl) => {
  const token = String(fileUrl || '').split('/').pop();
  const location = decodeFileToken(token);
  if (location.backend === 'database') {
    const { default: pool } = await import('../config/db.js');
    await pool.query('DELETE FROM stored_files WHERE id = $1', [location.fileId]);
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('Cloud file storage is unavailable.');
  const encodedPath = String(location.objectPath).split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(location.bucket)}/${encodedPath}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Cloud storage rejected deletion (${response.status}).`);
};

export const authorizeStoredFile = async (token, user) => {
  if (!user?.id || !user?.role) return false;
  const { default: pool } = await import('../config/db.js');
  const fileUrl = `/api/files/${token}`;
  const result = await pool.query(`
    SELECT owner_id
    FROM (
      SELECT student_id AS owner_id FROM time_records
      WHERE $1 IN (selfie_in_url, selfie_out_url, evidence_url)
      UNION
      SELECT student_id AS owner_id FROM student_documents WHERE file_url = $1
      UNION
      SELECT id AS owner_id FROM users WHERE profile_picture = $1
      UNION
      SELECT student_id AS owner_id FROM attendance_exceptions WHERE evidence_url = $1
    ) files
    LIMIT 1
  `, [fileUrl]);
  const ownerId = result.rows[0]?.owner_id;
  if (!ownerId) return false;
  if (ownerId === user.id) return true;
  if (!['coordinator', 'supervisor'].includes(user.role)) return false;
  const assignmentColumn = user.role === 'coordinator' ? 'coordinator_id' : 'supervisor_id';
  const assignment = await pool.query(
    `SELECT 1 FROM deployments WHERE student_id = $1 AND ${assignmentColumn} = $2 AND status = 'active'`,
    [ownerId, user.id]
  );
  return assignment.rows.length > 0;
};

export const getAttendanceFileMetadata = async (token) => {
  const { default: pool } = await import('../config/db.js');
  const fileUrl = `/api/files/${token}`;
  const result = await pool.query(`
    SELECT id AS time_record_id, student_id,
      CASE WHEN selfie_in_url = $1 THEN 'clock_in' WHEN selfie_out_url = $1 THEN 'clock_out' ELSE 'evidence' END AS image_type
    FROM time_records
    WHERE $1 IN (selfie_in_url, selfie_out_url, evidence_url)
    LIMIT 1
  `, [fileUrl]);
  return result.rows[0] || null;
};
