import crypto from 'node:crypto';
import sharp from 'sharp';
import { scanForMalware } from './malwareScanner.js';

// Existing Supabase bucket. Changing this string without renaming the bucket breaks file access.
const DEFAULT_STORAGE_BUCKET = 'trackpoint-files';

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const parseDataUrl = (value) => {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i.exec(value || '');
  if (!match) throw Object.assign(new Error('The uploaded file is invalid.'), { status: 400 });
  const encoded = match[2].replace(/\s/g, '');
  if (!encoded || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded))
    throw Object.assign(new Error('The uploaded file is invalid.'), { status: 400 });
  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
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
    if (existing.ok) return;
    const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: storageHeaders(serviceKey, true),
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: false,
        file_size_limit: 10 * 1024 * 1024,
        allowed_mime_types: [
          'image/jpeg', 'image/jpg', 'image/png',
          'application/pdf', 'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
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
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'application/msword')
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return false;
};

const sanitizeImage = async (mime, buffer) => {
  try {
    const image = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: 25_000_000,
      sequentialRead: true,
    }).rotate();
    const metadata = await image.metadata();
    const expectedFormat = mime === 'image/jpeg' ? 'jpeg' : 'png';
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height)
      throw new Error('Unexpected decoded image format.');
    return mime === 'image/jpeg'
      ? image.jpeg({ quality: 88, chromaSubsampling: '4:2:0' }).toBuffer()
      : image.png({ compressionLevel: 9 }).toBuffer();
  } catch (error) {
    throw Object.assign(new Error('The image could not be decoded safely.'), { status: 415, cause: error });
  }
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
  const { mime } = parsed;
  let { buffer } = parsed;
  if (!allowedTypes.includes(mime)) throw Object.assign(new Error('This file type is not allowed.'), { status: 415 });
  if (!buffer.length || buffer.length > maxBytes)
    throw Object.assign(new Error(`File must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`), { status: 413 });
  if (!hasExpectedSignature(mime, buffer))
    throw Object.assign(new Error('The file contents do not match the declared file type.'), { status: 415 });
  if (IMAGE_TYPES.includes(mime)) {
    buffer = await sanitizeImage(mime, buffer);
    if (buffer.length > maxBytes)
      throw Object.assign(new Error(`File must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB.`), { status: 413 });
  } else {
    await scanForMalware(buffer, MIME_EXTENSIONS[mime] || 'bin');
  }

  const storeInDatabase = async () => {
    const { default: pool } = await import('../config/db.js');
    const stored = await pool.query(
      `INSERT INTO stored_files (owner_id, mime_type, content, byte_size)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [ownerId, mime, buffer, buffer.length]
    );
    return createFileToken({ backend: 'database', fileId: stored.rows[0].id });
  };

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_STORAGE_BUCKET;
  if (!supabaseUrl || !serviceKey) return storeInDatabase();
  try { await ensureStorageBucket(supabaseUrl, serviceKey, bucket); }
  catch { /* Upload may still succeed, otherwise the database copy is used. */ }
  const objectPath = `${folder}/${ownerId}/${Date.now()}-${crypto.randomUUID()}.${MIME_EXTENSIONS[mime]}`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: { ...storageHeaders(serviceKey), 'Content-Type': mime, 'x-upsert': 'false' },
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
      'SELECT mime_type, content FROM stored_files WHERE id = $1',
      [location.fileId]
    );
    if (!stored.rows.length) throw Object.assign(new Error('File not found.'), { status: 404 });
    res.setHeader('Content-Type', stored.rows[0].mime_type);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(stored.rows[0].content);
  }
  if (!location.bucket || !location.objectPath)
    throw Object.assign(new Error('Invalid file link.'), { status: 404 });
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey)
    throw Object.assign(new Error('Cloud file storage is unavailable.'), { status: 503 });
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${location.bucket}/${location.objectPath}`, {
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
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${location.bucket}/${location.objectPath}`, {
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
  if (user.role === 'admin' || ownerId === user.id) return true;
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

export const IMAGE_TYPES = ['image/jpeg', 'image/png'];
export const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
