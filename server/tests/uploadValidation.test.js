import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import pool from '../config/db.js';
import { persistUpload } from '../utils/storage.js';

process.env.JWT_SECRET ||= 'upload-test-secret-with-at-least-32-characters';

test('upload validation rejects content that does not match its declared MIME type', async () => {
  const fakePng = `data:image/png;base64,${Buffer.from('this is not a png').toString('base64')}`;
  await assert.rejects(
    persistUpload(fakePng, {
      folder: 'test',
      ownerId: '00000000-0000-0000-0000-000000000000',
      allowedTypes: ['image/png'],
      maxBytes: 1024,
    }),
    error => error.status === 415 && /do not match/.test(error.message)
  );
});

test('camera images are decoded and re-encoded without requiring an external malware scanner', async () => {
  const originalQuery = pool.query;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let storedBuffer;
  pool.query = async (query, params = []) => {
    if (!String(query).includes('INSERT INTO stored_files')) return { rows: [] };
    storedBuffer = params[2];
    return { rows: [{ id: 'stored-image-id' }] };
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const encodedImage = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#2563eb' },
    }).jpeg().toBuffer();
    const appendedMarker = Buffer.from('untrusted-appended-payload');
    const submittedImage = Buffer.concat([encodedImage, appendedMarker]);
    const fileUrl = await persistUpload(
      `data:image/jpeg;base64,${submittedImage.toString('base64')}`,
      { folder: 'attendance/selfies', ownerId: 'student-1', allowedTypes: ['image/jpeg'], maxBytes: 1024 * 1024 },
    );

    assert.match(fileUrl, /^\/api\/files\//);
    assert.equal(storedBuffer.includes(appendedMarker), false);
    const metadata = await sharp(storedBuffer).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 8);
    assert.equal(metadata.height, 8);
  } finally {
    pool.query = originalQuery;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});
