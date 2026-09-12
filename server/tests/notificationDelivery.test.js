import assert from 'node:assert/strict';
import test from 'node:test';

test('notification delivery uses the server-only Supabase service-role credential', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'public-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'private-service-key';
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => '' };
  };
  try {
    const controller = await import(`../controllers/notificationController.js?service-role-test=${Date.now()}`);
    await controller.deliverNotification({
      user_id: '00000000-0000-4000-8000-000000000001',
      title: 'Attendance anomaly detected', body: 'Test Student left the perimeter.', type: 'anomaly',
    });
    assert.equal(request.url, 'https://example.supabase.co/rest/v1/notifications');
    assert.equal(request.options.headers.apikey, 'private-service-key');
    assert.equal(request.options.headers.Authorization, 'Bearer private-service-key');
    assert.doesNotMatch(request.options.headers.Authorization, /public-anon-key/);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalAnonKey;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});
