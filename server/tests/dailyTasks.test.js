import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../config/db.js';
import {
  createDailyTask,
  deleteDailyTask,
  excuseDailyTask,
  listStudentDailyTasks,
  listSupervisorDailyTasks,
  updateStudentDailyTask,
} from '../controllers/dailyTaskController.js';

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

const assignment = {
  id: 'assignment-1',
  template_id: 'template-1',
  deployment_id: 'deployment-1',
  student_id: 'student-1',
  status: 'missing',
  student_notes: null,
  completed_at: null,
  excused_at: null,
  excuse_remarks: null,
  updated_at: '2026-09-15T00:00:00.000Z',
  title: 'Submit work log',
  description: 'Log today’s duties',
  task_date: '2026-09-15',
  supervisor_id: 'supervisor-1',
  first_name: 'Ana',
  last_name: 'Cruz',
  email: 'ana@example.edu',
};

const mockPool = (handler) => {
  const originalQuery = pool.query;
  const calls = [];
  pool.query = async (query, params) => {
    calls.push({ query, params });
    return handler(query, params, calls);
  };
  return {
    calls,
    restore() { pool.query = originalQuery; },
  };
};

test('supervisor daily tasks default to missing for assigned trainees', async () => {
  const { restore } = mockPool((query) => {
    if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
    if (query.includes('FROM deployments d')) {
      return { rows: [{ deployment_id: 'deployment-1', student_id: 'student-1', first_name: 'Ana', last_name: 'Cruz' }] };
    }
    if (query.includes('INSERT INTO daily_task_templates')) {
      return { rows: [{ id: 'template-1', title: 'Submit work log', description: null, task_date: '2026-09-15', created_at: '2026-09-15T00:00:00.000Z' }] };
    }
    if (query.includes('INSERT INTO daily_task_assignments')) {
      return { rows: [{ id: 'assignment-1', student_id: 'student-1', deployment_id: 'deployment-1', status: 'missing' }] };
    }
    return { rows: [] };
  });
  try {
    const created = recorder();
    await createDailyTask({
      user: { id: 'supervisor-1' },
      body: { title: 'Submit work log', taskDate: '2026-09-15' },
    }, created.response);
    assert.equal(created.result.statusCode, 201);
    assert.equal(created.result.body.assignments[0].status, 'missing');
    assert.match(created.result.body.message, /1 trainee/);

    const listed = recorder();
    pool.query = async (query) => {
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
      if (query.includes('NOT EXISTS')) return { rows: [] };
      if (query.includes('SELECT DISTINCT') && query.includes('task_date')) return { rows: [{ task_date: '2026-09-15' }] };
      if (query.includes('FROM daily_task_assignments a')) return { rows: [assignment] };
      return { rows: [] };
    };
    await listSupervisorDailyTasks({ user: { id: 'supervisor-1' }, query: { date: '2026-09-15' } }, listed.response);
    assert.equal(listed.result.body.counts.missing, 1);
    assert.equal(listed.result.body.tasks[0].status, 'missing');
    assert.deepEqual(listed.result.body.availableDates, ['2026-09-15']);
  } finally { restore(); }
});

test('listing restores assignments when templates survive without trainee rows', async () => {
  const inserted = [];
  const { restore } = mockPool((query, params) => {
    if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
    if (query.includes('NOT EXISTS')) {
      return { rows: [{ template_id: 'template-1', deployment_id: 'deployment-2', student_id: 'student-1' }] };
    }
    if (query.includes('ON CONFLICT (template_id, student_id)')) {
      inserted.push(params);
      return { rows: [] };
    }
    if (query.includes('SELECT DISTINCT') && query.includes('task_date')) return { rows: [{ task_date: '2026-09-15' }] };
    if (query.includes('FROM daily_task_assignments a')) return { rows: [assignment] };
    return { rows: [] };
  });
  try {
    const listed = recorder();
    await listSupervisorDailyTasks({ user: { id: 'supervisor-1' }, query: { date: '2026-09-15' } }, listed.response);
    assert.equal(inserted.length, 1);
    assert.deepEqual(inserted[0], ['template-1', 'deployment-2', 'student-1']);
    assert.equal(listed.result.body.tasks[0].id, 'assignment-1');
  } finally { restore(); }
});

test('creating a daily task includes company trainees when supervisor_id is blank', async () => {
  let deploymentSql = '';
  const { restore } = mockPool((query) => {
    if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
    if (query.includes('FROM deployments d')) {
      deploymentSql = query;
      return { rows: [{ deployment_id: 'deployment-1', student_id: 'student-1', first_name: 'Ana', last_name: 'Cruz' }] };
    }
    if (query.includes('INSERT INTO daily_task_templates')) {
      return { rows: [{ id: 'template-1', title: 'Check inventory', description: null, task_date: '2026-09-16', created_at: '2026-09-16T00:00:00.000Z' }] };
    }
    if (query.includes('INSERT INTO daily_task_assignments')) {
      return { rows: [{ id: 'assignment-1', student_id: 'student-1', deployment_id: 'deployment-1', status: 'missing' }] };
    }
    return { rows: [] };
  });
  try {
    const created = recorder();
    await createDailyTask({
      user: { id: 'supervisor-1' },
      body: { title: 'Check inventory', taskDate: '2026-09-16' },
    }, created.response);
    assert.match(deploymentSql, /supervisor_id IS NULL/);
    assert.equal(created.result.statusCode, 201);
  } finally { restore(); }
});

test('students can move a daily task from missing to in progress or completed', async () => {
  const { restore } = mockPool((query) => {
    if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
    if (query.includes('FROM daily_task_assignments a')) return { rows: [assignment] };
    if (query.includes('UPDATE daily_task_assignments')) {
      return { rows: [{ id: 'assignment-1', status: 'in_progress', student_notes: null, completed_at: null, updated_at: '2026-09-15T01:00:00.000Z' }] };
    }
    return { rows: [] };
  });
  try {
    const invalid = recorder();
    await updateStudentDailyTask({
      params: { id: 'assignment-1' }, user: { id: 'student-1' }, body: { status: 'missing' },
    }, invalid.response);
    assert.equal(invalid.result.statusCode, 400);

    const started = recorder();
    await updateStudentDailyTask({
      params: { id: 'assignment-1' }, user: { id: 'student-1' }, body: { status: 'in_progress' },
    }, started.response);
    assert.equal(started.result.statusCode, 200);
    assert.equal(started.result.body.task.status, 'in_progress');

    const listed = recorder();
    pool.query = async (query) => {
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
      if (query.includes('NOT EXISTS')) return { rows: [] };
      if (query.includes('SELECT DISTINCT') && query.includes('task_date')) return { rows: [{ task_date: '2026-09-15' }] };
      if (query.includes('FROM daily_task_assignments a')) {
        return { rows: [{ ...assignment, status: 'in_progress' }, { ...assignment, id: 'assignment-2', status: 'completed' }] };
      }
      return { rows: [] };
    };
    await listStudentDailyTasks({ user: { id: 'student-1' }, query: { date: '2026-09-15' } }, listed.response);
    assert.equal(listed.result.body.counts.in_progress, 1);
    assert.equal(listed.result.body.counts.completed, 1);
    assert.equal(listed.result.body.counts.missing, 0);
  } finally { restore(); }
});

test('supervisors can excuse a specific student task that is not completed', async () => {
  const { restore } = mockPool((query, params) => {
    if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
    if (query.includes('FROM daily_task_assignments a')) return { rows: [{ ...assignment, status: 'in_progress' }] };
    if (query.includes("SET status = 'excused'")) {
      assert.equal(params[0], 'supervisor-1');
      assert.equal(params[1], 'Family emergency');
      return { rows: [{ id: 'assignment-1', status: 'excused', excuse_remarks: params[1], excused_at: '2026-09-15T02:00:00.000Z', updated_at: '2026-09-15T02:00:00.000Z' }] };
    }
    return { rows: [] };
  });
  try {
    const excused = recorder();
    await excuseDailyTask({
      params: { id: 'assignment-1' },
      user: { id: 'supervisor-1' },
      body: { remarks: 'Family emergency' },
    }, excused.response);
    assert.equal(excused.result.statusCode, 200);
    assert.equal(excused.result.body.task.status, 'excused');

    const blocked = recorder();
    pool.query = async (query) => {
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
      if (query.includes('FROM daily_task_assignments a')) return { rows: [{ ...assignment, status: 'completed' }] };
      return { rows: [] };
    };
    await excuseDailyTask({
      params: { id: 'assignment-1' }, user: { id: 'supervisor-1' }, body: {},
    }, blocked.response);
    assert.equal(blocked.result.statusCode, 409);
  } finally { restore(); }
});

test('supervisors can delete a daily task they created', async () => {
  const deleted = [];
  const { restore } = mockPool((query, params) => {
    if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
    if (query.includes('DELETE FROM daily_task_templates')) {
      deleted.push(params);
      return { rows: [{ id: params[0] }] };
    }
    if (query.includes('FROM daily_task_templates')) {
      return { rows: [{ id: 'template-1', title: 'Submit work log', task_date: '2026-09-15' }] };
    }
    if (query.includes('FROM daily_task_assignments')) {
      return { rows: [{ student_id: 'student-1' }, { student_id: 'student-2' }] };
    }
    return { rows: [] };
  });
  try {
    const removed = recorder();
    await deleteDailyTask({
      params: { id: 'template-1' },
      user: { id: 'supervisor-1' },
    }, removed.response);
    assert.equal(removed.result.statusCode, 200);
    assert.match(removed.result.body.message, /2 trainees/);
    assert.deepEqual(deleted[0], ['template-1', 'supervisor-1']);

    const missing = recorder();
    pool.query = async (query) => {
      if (query.includes('CREATE TABLE') || query.includes('CREATE INDEX')) return { rows: [] };
      return { rows: [] };
    };
    await deleteDailyTask({
      params: { id: 'template-missing' },
      user: { id: 'supervisor-1' },
    }, missing.response);
    assert.equal(missing.result.statusCode, 404);
  } finally { restore(); }
});
