import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../config/db.js';
import { bulkUserAction, updateUser } from '../controllers/userController.js';

const responseRecorder = () => {
  const result = { statusCode: 200, body: null };
  return {
    result,
    response: {
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return this; },
    },
  };
};

test('updateUser persists normalized profile and education fields', async () => {
  const originalQuery = pool.query;
  const updateCalls = [];
  pool.query = async (query, params) => {
    if (query.includes('SELECT id FROM users')) return { rows: [] };
    if (query.includes('UPDATE users SET')) {
      updateCalls.push({ query, params });
      return { rows: [{ id: params.at(-1), email: params[2], course: params[5], school: params[6] }] };
    }
    return { rows: [] };
  };

  try {
    const { response, result } = responseRecorder();
    await updateUser({
      params: { id: 'user-2' },
      user: { id: 'admin-1', role: 'admin' },
      body: {
        firstName: '  Jane ', lastName: ' Student  ', email: ' JANE@EXAMPLE.EDU ',
        role: 'student', phone: ' 09123456789 ', course: ' BSIT ', school: ' Example University ',
        password: '',
      },
    }, response);

    assert.equal(result.statusCode, 200);
    assert.equal(updateCalls.length, 1);
    assert.match(updateCalls[0].query, /course=\$6, school=\$7/);
    assert.deepEqual(updateCalls[0].params, [
      'Jane', 'Student', 'jane@example.edu', 'student', '09123456789',
      'BSIT', 'Example University', 'user-2',
    ]);
  } finally {
    pool.query = originalQuery;
  }
});

test('updateUser prevents an administrator from changing their own role', async () => {
  const { response, result } = responseRecorder();
  await updateUser({
    params: { id: 'admin-1' },
    user: { id: 'admin-1', role: 'admin' },
    body: { firstName: 'System', lastName: 'Admin', email: 'admin@example.com', role: 'student' },
  }, response);

  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /own administrator role/i);
});

test('bulkUserAction prevents destructive actions against the current administrator', async () => {
  const { response, result } = responseRecorder();
  await bulkUserAction({
    user: { id: 'admin-1' },
    body: { action: 'delete', ids: ['student-1', 'admin-1'] },
  }, response);

  assert.equal(result.statusCode, 400);
  assert.match(result.body.message, /own account/i);
});
