import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../config/db.js';
import { notifyAttendanceAnomaly } from '../controllers/dtrController.js';

test('attendance anomalies notify each assigned coordinator and supervisor once', async () => {
  const originalQuery = pool.query;
  const queued = [];
  pool.query = async (query, params) => {
    if (query.includes('ARRAY_REMOVE')) return { rows: [{
      first_name: 'Test', last_name: 'Student',
      reviewer_ids: ['coordinator-1', 'supervisor-1', 'coordinator-1'],
    }] };
    if (query.includes('INSERT INTO notification_outbox')) {
      queued.push(params);
      return { rows: [{ id: `notification-${queued.length}`, status: 'pending' }] };
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  try {
    const count = await notifyAttendanceAnomaly('student-1', 'Time-in outside approved worksite');
    assert.equal(count, 2);
    assert.deepEqual(queued.map(values => values[0]).sort(), ['coordinator-1', 'supervisor-1']);
    assert.ok(queued.every(values => values[3] === 'anomaly'));
    assert.ok(queued.every(values => values[2].includes('Time-in outside approved worksite')));
  } finally { pool.query = originalQuery; }
});

test('empty anomaly flags do not enqueue notifications', async () => {
  const originalQuery = pool.query;
  let queried = false;
  pool.query = async () => { queried = true; return { rows: [] }; };
  try {
    assert.equal(await notifyAttendanceAnomaly('student-1', ''), 0);
    assert.equal(queried, false);
  } finally { pool.query = originalQuery; }
});
