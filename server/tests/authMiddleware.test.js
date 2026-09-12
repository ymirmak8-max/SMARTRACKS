import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const response = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

const activeUser = {
  id: 'user-1', email: 'user@test.local', role: 'student', is_active: true,
  approval_status: 'approved', mfa_enabled: false, token_version: 0,
  privacy_notice_version: 'v1', current_privacy_version: 'v1',
};

const withUser = async (user, callback) => {
  const original = pool.query;
  pool.query = async () => ({ rows: user ? [user] : [] });
  try { await callback(); } finally { pool.query = original; }
};

const request = (claims = {}, path = '/today', baseUrl = '/api/dtr') => {
  process.env.JWT_SECRET = 'test-secret';
  const token = jwt.sign({ id: 'user-1', role: 'student', tokenVersion: 0, ...claims }, process.env.JWT_SECRET);
  return { headers: { authorization: `Bearer ${token}` }, path, baseUrl };
};

test('verifyToken rejects missing credentials', async () => {
  const res = response();
  await verifyToken({ headers: {} }, res, () => assert.fail('next should not run'));
  assert.equal(res.statusCode, 401);
});

test('verifyToken accepts a current active session', async () => withUser(activeUser, async () => {
  const req = request();
  let called = false;
  await verifyToken(req, response(), () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.user.id, 'user-1');
}));

test('verifyToken immediately rejects revoked token versions', async () => withUser(
  { ...activeUser, token_version: 2 },
  async () => {
    const res = response();
    await verifyToken(request(), res, () => assert.fail('next should not run'));
    assert.equal(res.statusCode, 401);
    assert.match(res.payload.message, /revoked/i);
  }
));

test('verifyToken enforces the current privacy notice on APIs', async () => withUser(
  { ...activeUser, privacy_notice_version: 'old' },
  async () => {
    const res = response();
    await verifyToken(request(), res, () => assert.fail('next should not run'));
    assert.equal(res.statusCode, 428);
    assert.equal(res.payload.code, 'PRIVACY_NOTICE_REQUIRED');
  }
));

test('verifyToken requires administrator MFA outside setup routes', async () => withUser(
  { ...activeUser, role: 'admin' },
  async () => {
    const res = response();
    await verifyToken(request({ role: 'admin' }, '/', '/api/users'), res, () => assert.fail('next should not run'));
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, 'ADMIN_MFA_REQUIRED');
    assert.match(res.payload.message, /authenticator MFA/i);
  }
));

test('authorize rejects roles outside the allowlist', () => {
  const res = response();
  authorize('admin')({ user: { role: 'student' } }, res, () => assert.fail('next should not run'));
  assert.equal(res.statusCode, 403);
  assert.match(res.payload.message, /administrator/i);
});

test('authorize lets administrators through any role allowlist', () => {
  let called = false;
  authorize('coordinator')({ user: { role: 'admin' } }, response(), () => { called = true; });
  assert.equal(called, true);
});
