import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'contract-test-secret-with-32-characters';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role';

const { default: app } = await import('../server.js');
const { default: pool } = await import('../config/db.js');
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

test('unknown API endpoints use the JSON 404 contract', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { message: 'API route not found' });
});

test('protected endpoints reject requests without credentials', async () => {
  const response = await fetch(`${baseUrl}/api/users`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: 'Access token required.' });
});

test('login validates required credentials before querying the database', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: '' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: 'Email and password are required.' });
});

test('CORS rejects unconfigured browser origins', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`, {
    headers: { origin: 'https://untrusted.example' },
  });
  assert.equal(response.status, 403);
});

test('cron workers reject missing credentials', async () => {
  const response = await fetch(`${baseUrl}/api/cron/workers`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { message: 'Unauthorized.' });
});
