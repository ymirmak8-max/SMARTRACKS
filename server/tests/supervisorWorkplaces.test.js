import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../config/db.js';
import {
  __test__,
  createWorkplace,
  getStudentActivity,
  getWorkplaces,
  removeWorkplace,
  updateWorkplace,
} from '../controllers/supervisorController.js';

const { buildMissedDays, parseRadius, parseCoordinates } = __test__;

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

const mockPool = (handler) => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (query, params) => {
    calls.push({ query, params });
    return handler(query, params, calls);
  };
  return { calls, restore() { pool.query = originalQuery; } };
};

const request = (overrides = {}) => ({
  user: { id: 'supervisor-1', role: 'supervisor' },
  params: {},
  body: {},
  get: () => 'test-agent',
  ...overrides,
});

const subWorkplace = {
  id: 'location-2',
  company_id: 'company-1',
  name: 'Warehouse',
  address: 'Back lot',
  latitude: 10.3,
  longitude: 123.9,
  geo_radius_meters: 80,
  attendance_mode: 'fixed',
  is_primary: false,
  is_active: true,
};

const primaryWorkplace = { ...subWorkplace, id: 'location-1', name: 'Main office', is_primary: true, geo_radius_meters: 50 };

const companyLookup = (query) => query.includes('SELECT DISTINCT company_id');

const manilaDay = (offset) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

test('radius and coordinate parsing enforce geofence limits', () => {
  assert.equal(parseRadius(50), 50);
  assert.equal(parseRadius('120.4'), 120);
  assert.equal(parseRadius(9), null);
  assert.equal(parseRadius(5001), null);
  assert.equal(parseRadius('abc'), null);
  assert.deepEqual(parseCoordinates('', ''), { latitude: null, longitude: null });
  assert.deepEqual(parseCoordinates('10.5', '123.25'), { latitude: 10.5, longitude: 123.25 });
  assert.equal(parseCoordinates(91, 120), null);
  assert.equal(parseCoordinates(10, 'x'), null);
});

test('missed days skip recorded days, approved leave, weekends, and today', () => {
  const days = Array.from({ length: 14 }, (_, index) => manilaDay(-14 + index));
  const weekday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();
  const workdays = days.filter((key) => weekday(key) >= 1 && weekday(key) <= 5);
  const [recordedDay, leaveDay, ...rest] = workdays;

  const missed = buildMissedDays({
    records: [{ date: recordedDay }],
    exceptions: [{ date_from: leaveDay, date_to: leaveDay }],
    workDays: [1, 2, 3, 4, 5],
    startDate: days[0],
    endDate: null,
    lookbackDays: 30,
  });

  assert.deepEqual(missed, [...rest].reverse());
  assert.ok(!missed.includes(manilaDay(0)));
  assert.ok(missed.every((key) => weekday(key) >= 1 && weekday(key) <= 5));
});

test('supervisor workplaces list the company with parsed locations', async () => {
  const { restore } = mockPool((query) => {
    if (companyLookup(query)) return { rows: [{ company_id: 'company-1' }] };
    if (query.includes('FROM companies c')) {
      return { rows: [{ id: 'company-1', name: 'Acme Corp', locations: JSON.stringify([{ ...primaryWorkplace, my_trainee_count: 2 }]) }] };
    }
    return { rows: [] };
  });
  const { result, response } = recorder();
  try {
    await getWorkplaces(request(), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.companies[0].name, 'Acme Corp');
  assert.equal(result.body.companies[0].locations[0].name, 'Main office');
});

test('supervisor cannot add a workplace to another company', async () => {
  const { restore, calls } = mockPool((query) => (companyLookup(query) ? { rows: [{ company_id: 'company-1' }] } : { rows: [] }));
  const { result, response } = recorder();
  try {
    await createWorkplace(request({ body: { companyId: 'company-2', name: 'Branch', latitude: 10, longitude: 123 } }), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 403);
  assert.ok(!calls.some(({ query }) => query.includes('INSERT INTO company_locations')));
});

test('fixed sub-workplace requires coordinates and a valid radius', async () => {
  const { restore } = mockPool((query) => (companyLookup(query) ? { rows: [{ company_id: 'company-1' }] } : { rows: [] }));
  try {
    const missingPoint = recorder();
    await createWorkplace(request({ body: { name: 'Branch', attendanceMode: 'fixed' } }), missingPoint.response);
    assert.equal(missingPoint.result.statusCode, 400);

    const badRadius = recorder();
    await createWorkplace(request({ body: { name: 'Branch', latitude: 10, longitude: 123, geoRadiusMeters: 5 } }), badRadius.response);
    assert.equal(badRadius.result.statusCode, 400);
  } finally { restore(); }
});

test('new sub-workplace is attached to the supervisor’s trainees', async () => {
  const { restore, calls } = mockPool((query) => {
    if (companyLookup(query)) return { rows: [{ company_id: 'company-1' }] };
    if (query.includes('INSERT INTO company_locations')) return { rows: [{ ...subWorkplace }] };
    if (query.includes('INSERT INTO deployment_locations')) return { rows: [{ deployment_id: 'd-1' }, { deployment_id: 'd-2' }] };
    return { rows: [] };
  });
  const { result, response } = recorder();
  try {
    await createWorkplace(request({
      body: { name: 'Warehouse', latitude: 10.3, longitude: 123.9, geoRadiusMeters: 80, attendanceMode: 'fixed' },
    }), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 201);
  assert.match(result.body.message, /2 trainees can now time in/);
  const insert = calls.find(({ query }) => query.includes('INSERT INTO company_locations'));
  assert.deepEqual(insert.params, ['company-1', 'Warehouse', null, 10.3, 123.9, 80, 'fixed']);
  assert.ok(calls.some(({ query }) => query.includes('INSERT INTO audit_logs')));
});

test('main workplace only changes radius and syncs the company geofence', async () => {
  const { restore, calls } = mockPool((query, params) => {
    if (companyLookup(query)) return { rows: [{ company_id: 'company-1' }] };
    if (query.includes('FROM company_locations') && query.includes('ANY($2::uuid[])')) return { rows: [{ ...primaryWorkplace }] };
    if (query.includes('UPDATE company_locations')) {
      return { rows: [{ ...primaryWorkplace, name: params[0], geo_radius_meters: params[4] }] };
    }
    return { rows: [] };
  });
  const { result, response } = recorder();
  try {
    await updateWorkplace(request({ params: { id: 'location-1' }, body: { name: 'Renamed', geoRadiusMeters: 150 } }), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.location.name, 'Main office');
  assert.match(result.body.message, /150 m/);
  const sync = calls.find(({ query }) => query.includes('UPDATE companies SET geo_radius_meters'));
  assert.deepEqual(sync.params, [150, 'company-1']);
});

test('workplace outside the supervisor company cannot be edited', async () => {
  const { restore } = mockPool((query) => (companyLookup(query) ? { rows: [{ company_id: 'company-1' }] } : { rows: [] }));
  const { result, response } = recorder();
  try {
    await updateWorkplace(request({ params: { id: 'foreign' }, body: { geoRadiusMeters: 100 } }), response);
  } finally { restore(); }
  assert.equal(result.statusCode, 404);
});

test('main workplace cannot be removed', async () => {
  const { restore, calls } = mockPool((query) => {
    if (companyLookup(query)) return { rows: [{ company_id: 'company-1' }] };
    if (query.includes('FROM company_locations')) return { rows: [{ ...primaryWorkplace }] };
    return { rows: [] };
  });
  const { result, response } = recorder();
  try {
    await removeWorkplace(request({ params: { id: 'location-1' } }), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 409);
  assert.ok(!calls.some(({ query }) => query.includes('is_active = false')));
});

test('sub-workplace used by another supervisor’s trainees is not removed', async () => {
  const { restore, calls } = mockPool((query) => {
    if (companyLookup(query)) return { rows: [{ company_id: 'company-1' }] };
    if (query.includes('FROM company_locations')) return { rows: [{ ...subWorkplace }] };
    if (query.includes('AS other_count')) return { rows: [{ primary_count: 0, other_count: 1 }] };
    return { rows: [] };
  });
  const { result, response } = recorder();
  try {
    await removeWorkplace(request({ params: { id: 'location-2' } }), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 409);
  assert.ok(!calls.some(({ query }) => query.includes('is_active = false')));
});

test('unused sub-workplace is detached and archived', async () => {
  const { restore, calls } = mockPool((query) => {
    if (companyLookup(query)) return { rows: [{ company_id: 'company-1' }] };
    if (query.includes('FROM company_locations')) return { rows: [{ ...subWorkplace }] };
    if (query.includes('AS other_count')) return { rows: [{ primary_count: 0, other_count: 0 }] };
    return { rows: [] };
  });
  const { result, response } = recorder();
  try {
    await removeWorkplace(request({ params: { id: 'location-2' } }), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 200);
  assert.ok(calls.some(({ query }) => query.includes('DELETE FROM deployment_locations')));
  assert.ok(calls.some(({ query }) => query.includes('SET is_active = false')));
});

test('activity is refused for a trainee not assigned to the supervisor', async () => {
  const { restore } = mockPool(() => ({ rows: [] }));
  const { result, response } = recorder();
  try {
    await getStudentActivity(request({ params: { studentId: 'student-9' } }), response);
  } finally { restore(); }
  assert.equal(result.statusCode, 404);
});

test('activity returns records with photos, notes, and totals', async () => {
  const today = manilaDay(0);
  const { restore } = mockPool((query) => {
    if (query.includes('FROM deployments d')) {
      return { rows: [{
        deployment_id: 'deployment-1', student_id: 'student-1', company_id: 'company-1', required_hours: 486,
        start_date: today, end_date: null, work_days: [0, 1, 2, 3, 4, 5, 6],
        first_name: 'Ana', last_name: 'Cruz', company_name: 'Acme Corp', worksite_name: 'Main office',
      }] };
    }
    if (query.includes('FROM time_records tr')) {
      return { rows: [{
        id: 'record-1', date: today, clock_in: `${today}T00:05:00.000Z`, clock_out: null, total_hours: null,
        selfie_in_url: '/api/files/a', evidence_url: '/api/files/b', evidence_note: 'Inventory count',
      }] };
    }
    if (query.includes('hours_rendered')) return { rows: [{ hours_rendered: '12.5', days_present: 2, days_late: 1, days_flagged: 0 }] };
    return { rows: [] };
  });
  const { result, response } = recorder();
  try {
    await getStudentActivity(request({ params: { studentId: 'student-1' } }), response);
  } finally { restore(); }

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.student.company_name, 'Acme Corp');
  assert.equal(result.body.records[0].evidence_note, 'Inventory count');
  assert.equal(result.body.totals.hoursRendered, 12.5);
  assert.equal(result.body.totals.requiredHours, 486);
  assert.deepEqual(result.body.missedDays, []);
});
