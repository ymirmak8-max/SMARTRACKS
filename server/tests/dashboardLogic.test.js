import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../config/db.js';
import { submitEvaluation } from '../controllers/evaluationController.js';
import { getMyCompletion } from '../controllers/completionController.js';
import { getAnnouncements } from '../controllers/coordinatorController.js';
import { summarizeAttendance } from '../controllers/analyticsController.js';
import { classifyWorksitePosition } from '../controllers/dtrController.js';

const recorder = () => {
  const result = { statusCode: 200, body: null };
  return {
    result,
    response: {
      status(code) { result.statusCode = code; return this; },
      json(body) { result.body = body; return this; },
    },
  };
};

const validScores = {
  attitude: 90,
  technical: 90,
  communication: 90,
  teamwork: 90,
  initiative: 90,
  quality: 90,
};

test('accuracy-aware geofence distinguishes inside, uncertain, and outside positions', () => {
  const locations = [{
    id: 'site-1', name: 'Test worksite', latitude: 0, longitude: 0,
    geoRadiusMeters: 50, attendanceMode: 'fixed',
  }];
  const positionAtMeters = meters => ({ latitude: meters / 111195, longitude: 0 });

  assert.equal(classifyWorksitePosition(locations, positionAtMeters(20), 10).state, 'inside');
  assert.equal(classifyWorksitePosition(locations, positionAtMeters(45), 10).state, 'uncertain');
  assert.equal(classifyWorksitePosition(locations, positionAtMeters(70), 10).state, 'outside');
});

test('final evaluations are rejected until a midterm exists', async () => {
  const originalQuery = pool.query;
  pool.query = async query => {
    if (query.includes('FROM deployments')) return { rows: [{ id: 'deployment-1' }] };
    if (query.includes('FROM evaluations')) return { rows: [] };
    throw new Error('Evaluation insert must not run before the prerequisite is met.');
  };
  try {
    const { response, result } = recorder();
    await submitEvaluation({
      user: { id: 'supervisor-1' },
      body: { deploymentId: 'deployment-1', period: 'final', scores: validScores },
    }, response);
    assert.equal(result.statusCode, 409);
    assert.match(result.body.message, /midterm evaluation before the final/i);
  } finally { pool.query = originalQuery; }
});

test('completion readiness counts only active required documents', async () => {
  const originalQuery = pool.query;
  let readinessSql = '';
  pool.query = async query => {
    readinessSql = query;
    return { rows: [{
      id: 'deployment-1', rendered_hours: 486, required_hours: 486,
      required_documents: 1, approved_documents: 1, has_final_evaluation: true,
    }] };
  };
  try {
    const { response, result } = recorder();
    await getMyCompletion({ user: { id: 'student-1' } }, response);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.completion.ready, true);
    assert.match(readinessSql, /dr\.is_required AND dr\.is_active/);
  } finally { pool.query = originalQuery; }
});

test('announcement authors can see their own role-targeted posts', async () => {
  const originalQuery = pool.query;
  let queryText = '';
  let queryParams = [];
  pool.query = async (query, params) => {
    queryText = query;
    queryParams = params;
    return { rows: [] };
  };
  try {
    const { response, result } = recorder();
    await getAnnouncements({ user: { id: 'coordinator-1', role: 'coordinator' } }, response);
    assert.equal(result.statusCode, 200);
    assert.match(queryText, /a\.created_by = \$2/);
    assert.deepEqual(queryParams, ['coordinator', 'coordinator-1']);
  } finally { pool.query = originalQuery; }
});

test('verified current or off-schedule attendance remains present in analytics', () => {
  const summary = summarizeAttendance({
    dtr: [
      { date: '2026-08-04', clock_in: '2026-08-04T00:00:00Z', is_valid: true },
      { date: '2026-08-06', clock_in: '2026-08-06T00:00:00Z', is_valid: true },
    ],
    expectedDateSet: new Set(['2026-08-04', '2026-08-05']),
  });
  assert.equal(summary.verifiedDays, 2);
  assert.equal(summary.scheduledPresentDays, 1);
  assert.equal(summary.additionalVerifiedDays, 1);
  assert.equal(summary.absentDays, 1);
});
