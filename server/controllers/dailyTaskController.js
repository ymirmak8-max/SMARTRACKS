import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';
import { sendNotification } from './notificationController.js';

const TASK_STATUSES = ['missing', 'in_progress', 'completed', 'excused'];
const STUDENT_STATUSES = ['in_progress', 'completed'];

let tablesReady = null;
const ensureDailyTaskTables = async () => {
  tablesReady ||= pool.query(`
    CREATE TABLE IF NOT EXISTS daily_task_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      supervisor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      task_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => pool.query(`
    CREATE TABLE IF NOT EXISTS daily_task_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES daily_task_templates(id) ON DELETE CASCADE,
      deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
      student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'missing'
        CHECK (status IN ('missing', 'in_progress', 'completed', 'excused')),
      student_notes TEXT,
      completed_at TIMESTAMPTZ,
      excused_by UUID REFERENCES users(id) ON DELETE SET NULL,
      excused_at TIMESTAMPTZ,
      excuse_remarks TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (template_id, student_id)
    )
  `)).then(() => pool.query(
    'CREATE INDEX IF NOT EXISTS daily_task_templates_supervisor_date_idx ON daily_task_templates (supervisor_id, task_date DESC)'
  )).then(() => pool.query(
    'CREATE INDEX IF NOT EXISTS daily_task_assignments_student_idx ON daily_task_assignments (student_id, status)'
  )).catch((error) => {
    tablesReady = null;
    throw error;
  });
  await tablesReady;
};

const manilaDate = (value) => {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
};

const assignmentSelect = `
  SELECT a.id, a.template_id, a.deployment_id, a.student_id, a.status, a.student_notes,
         a.completed_at, a.excused_at, a.excuse_remarks, a.updated_at,
         t.title, t.description, t.task_date::text AS task_date, t.supervisor_id,
         u.first_name, u.last_name, u.email
  FROM daily_task_assignments a
  JOIN daily_task_templates t ON t.id = a.template_id
  JOIN users u ON u.id = a.student_id
`;

const dateKey = (value) => {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

const supervisorDeploymentMatch = `
  d.status = 'active'
  AND (
    d.supervisor_id = t.supervisor_id
    OR (
      d.supervisor_id IS NULL
      AND d.company_id = (SELECT company_id FROM users WHERE id = t.supervisor_id)
    )
  )
`;

const loadAssignedStudents = async (supervisorId, studentIds = null) => {
  const filter = Array.isArray(studentIds) && studentIds.length
    ? 'AND d.student_id = ANY($2::uuid[])'
    : '';
  const params = Array.isArray(studentIds) && studentIds.length ? [supervisorId, studentIds] : [supervisorId];
  const result = await pool.query(
    `SELECT d.id AS deployment_id, d.student_id, u.first_name, u.last_name
     FROM deployments d
     JOIN users u ON u.id = d.student_id
     WHERE d.status = 'active'
       AND (
         d.supervisor_id = $1
         OR (d.supervisor_id IS NULL AND d.company_id = (SELECT company_id FROM users WHERE id = $1))
       )
       ${filter}
     ORDER BY u.last_name, u.first_name`,
    params
  );
  return result.rows;
};

const restoreMissingAssignments = async ({ supervisorId = null, studentId = null, taskDate = null }) => {
  const missing = await pool.query(
    `SELECT t.id AS template_id, d.id AS deployment_id, d.student_id
     FROM daily_task_templates t
     JOIN deployments d ON ${supervisorDeploymentMatch}
     WHERE ($1::uuid IS NULL OR t.supervisor_id = $1)
       AND ($2::uuid IS NULL OR d.student_id = $2)
       AND ($3::date IS NULL OR t.task_date = $3::date)
       AND t.task_date >= (CURRENT_DATE - 30)
       AND NOT EXISTS (
         SELECT 1 FROM daily_task_assignments a
         WHERE a.template_id = t.id AND a.student_id = d.student_id
       )`,
    [supervisorId, studentId, taskDate]
  );
  for (const row of missing.rows) {
    await pool.query(
      `INSERT INTO daily_task_assignments (template_id, deployment_id, student_id, status)
       VALUES ($1, $2, $3, 'missing')
       ON CONFLICT (template_id, student_id) DO NOTHING`,
      [row.template_id, row.deployment_id, row.student_id]
    );
  }
};

const loadAvailableDates = async ({ supervisorId = null, studentId = null }) => {
  const result = studentId
    ? await pool.query(
        `SELECT DISTINCT t.task_date::text AS task_date
         FROM daily_task_templates t
         WHERE t.task_date >= (CURRENT_DATE - 30)
           AND (
             EXISTS (
               SELECT 1 FROM daily_task_assignments a
               WHERE a.template_id = t.id AND a.student_id = $1
             )
             OR EXISTS (
               SELECT 1 FROM deployments d
               WHERE d.student_id = $1 AND ${supervisorDeploymentMatch}
             )
           )
         ORDER BY task_date DESC`,
        [studentId]
      )
    : await pool.query(
        `SELECT DISTINCT task_date::text AS task_date
         FROM daily_task_templates
         WHERE supervisor_id = $1
           AND task_date >= (CURRENT_DATE - 30)
         ORDER BY task_date DESC`,
        [supervisorId]
      );
  return result.rows.map((row) => dateKey(row.task_date)).filter(Boolean);
};

const countsFrom = (tasks) => tasks.reduce((counts, task) => {
  counts[task.status] = (counts[task.status] || 0) + 1;
  return counts;
}, { missing: 0, in_progress: 0, completed: 0, excused: 0 });

export const createDailyTask = async (req, res) => {
  try {
    await ensureDailyTaskTables();
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const taskDate = manilaDate(req.body?.taskDate);
    if (!title) return res.status(400).json({ message: 'A task title is required.' });
    if (title.length > 200) return res.status(400).json({ message: 'Task title must be 200 characters or fewer.' });

    const requestedIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds.map(String).filter(Boolean)
      : [];
    const students = await loadAssignedStudents(req.user.id, requestedIds.length ? requestedIds : null);
    if (!students.length)
      return res.status(400).json({ message: 'No assigned trainees are available for this task.' });

    const template = await pool.query(
      `INSERT INTO daily_task_templates (supervisor_id, title, description, task_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, description, task_date, created_at`,
      [req.user.id, title, description || null, taskDate]
    );
    const templateId = template.rows[0].id;
    const assignments = [];
    for (const student of students) {
      const inserted = await pool.query(
        `INSERT INTO daily_task_assignments (template_id, deployment_id, student_id, status)
         VALUES ($1, $2, $3, 'missing')
         RETURNING id, student_id, deployment_id, status`,
        [templateId, student.deployment_id, student.student_id]
      );
      assignments.push({ ...inserted.rows[0], first_name: student.first_name, last_name: student.last_name });
      await sendNotification(
        student.student_id,
        'New daily task',
        `${title} is due ${taskDate}.`,
        'general'
      ).catch(() => {});
    }

    await writeAuditLog({
      actorId: req.user.id, action: 'daily_task.create', entityType: 'daily_task_template',
      entityId: templateId, details: { studentCount: assignments.length, taskDate }, req,
    });

    return res.status(201).json({
      message: `Task assigned to ${assignments.length} trainee${assignments.length === 1 ? '' : 's'}.`,
      template: template.rows[0],
      assignments,
    });
  } catch (error) {
    console.error('Create daily task error:', error);
    return res.status(500).json({ message: 'Unable to create the daily task.' });
  }
};

export const listSupervisorDailyTasks = async (req, res) => {
  try {
    await ensureDailyTaskTables();
    const taskDate = manilaDate(req.query?.date);
    await restoreMissingAssignments({ supervisorId: req.user.id });
    const result = await pool.query(
      `${assignmentSelect}
       WHERE t.supervisor_id = $1 AND t.task_date = $2::date
       ORDER BY u.last_name, u.first_name, t.created_at DESC`,
      [req.user.id, taskDate]
    );
    const availableDates = await loadAvailableDates({ supervisorId: req.user.id });
    return res.status(200).json({
      date: taskDate,
      tasks: result.rows,
      counts: countsFrom(result.rows),
      availableDates,
    });
  } catch (error) {
    console.error('List supervisor daily tasks error:', error);
    return res.status(500).json({ message: 'Unable to load daily tasks.' });
  }
};

export const listStudentDailyTasks = async (req, res) => {
  try {
    await ensureDailyTaskTables();
    const taskDate = manilaDate(req.query?.date);
    await restoreMissingAssignments({ studentId: req.user.id });
    const result = await pool.query(
      `${assignmentSelect}
       WHERE a.student_id = $1
         AND (
           t.task_date = $2::date
           OR (t.task_date >= ($2::date - 7) AND a.status IN ('missing', 'in_progress'))
         )
       ORDER BY t.task_date DESC, t.created_at DESC`,
      [req.user.id, taskDate]
    );
    const availableDates = await loadAvailableDates({ studentId: req.user.id });
    return res.status(200).json({
      date: taskDate,
      tasks: result.rows,
      counts: countsFrom(result.rows),
      availableDates,
    });
  } catch (error) {
    console.error('List student daily tasks error:', error);
    return res.status(500).json({ message: 'Unable to load your daily tasks.' });
  }
};

export const updateStudentDailyTask = async (req, res) => {
  try {
    await ensureDailyTaskTables();
    const status = String(req.body?.status || '').trim();
    const notes = String(req.body?.notes || '').trim();
    if (!STUDENT_STATUSES.includes(status))
      return res.status(400).json({ message: 'Mark the task in progress or completed.' });

    const current = await pool.query(
      `${assignmentSelect} WHERE a.id = $1 AND a.student_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!current.rows.length) return res.status(404).json({ message: 'Task not found.' });
    const task = current.rows[0];
    if (task.status === 'excused')
      return res.status(409).json({ message: 'This task was excused by your supervisor.' });
    if (task.status === 'completed' && status === 'in_progress')
      return res.status(409).json({ message: 'This task is already completed.' });

    const updated = await pool.query(
      `UPDATE daily_task_assignments
       SET status = $1,
           student_notes = COALESCE(NULLIF($2, ''), student_notes),
           completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END,
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, status, student_notes, completed_at, updated_at`,
      [status, notes, req.params.id]
    );

    if (status === 'completed') {
      await sendNotification(
        task.supervisor_id,
        'Daily task completed',
        `${task.first_name} ${task.last_name} completed “${task.title}”.`,
        'general'
      ).catch(() => {});
    }

    await writeAuditLog({
      actorId: req.user.id, action: 'daily_task.student_update', entityType: 'daily_task_assignment',
      entityId: req.params.id, details: { status }, req,
    });

    return res.status(200).json({ message: status === 'completed' ? 'Task completed.' : 'Task marked in progress.', task: { ...task, ...updated.rows[0] } });
  } catch (error) {
    console.error('Update student daily task error:', error);
    return res.status(500).json({ message: 'Unable to update the task.' });
  }
};

export const excuseDailyTask = async (req, res) => {
  try {
    await ensureDailyTaskTables();
    const remarks = String(req.body?.remarks || '').trim();
    const current = await pool.query(
      `${assignmentSelect}
       WHERE a.id = $1 AND t.supervisor_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!current.rows.length) return res.status(404).json({ message: 'Task not found.' });
    const task = current.rows[0];
    if (task.status === 'completed')
      return res.status(409).json({ message: 'Completed tasks cannot be excused.' });

    const updated = await pool.query(
      `UPDATE daily_task_assignments
       SET status = 'excused', excused_by = $1, excused_at = NOW(),
           excuse_remarks = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, status, excuse_remarks, excused_at, updated_at`,
      [req.user.id, remarks || null, req.params.id]
    );

    await sendNotification(
      task.student_id,
      'Daily task excused',
      `“${task.title}” was marked excused${remarks ? `: ${remarks}` : '.'}`,
      'general'
    ).catch(() => {});

    await writeAuditLog({
      actorId: req.user.id, action: 'daily_task.excuse', entityType: 'daily_task_assignment',
      entityId: req.params.id, details: { remarks: remarks || null }, req,
    });

    return res.status(200).json({ message: 'Task marked excused.', task: { ...task, ...updated.rows[0] } });
  } catch (error) {
    console.error('Excuse daily task error:', error);
    return res.status(500).json({ message: 'Unable to excuse the task.' });
  }
};

export const deleteDailyTask = async (req, res) => {
  try {
    await ensureDailyTaskTables();
    const template = await pool.query(
      `SELECT id, title, task_date::text AS task_date
       FROM daily_task_templates
       WHERE id = $1 AND supervisor_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!template.rows.length) return res.status(404).json({ message: 'Task not found.' });

    const assigned = await pool.query(
      'SELECT student_id FROM daily_task_assignments WHERE template_id = $1',
      [req.params.id]
    );
    const removed = await pool.query(
      `DELETE FROM daily_task_templates
       WHERE id = $1 AND supervisor_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!removed.rows.length) return res.status(404).json({ message: 'Task not found.' });

    const task = template.rows[0];
    for (const row of assigned.rows) {
      await sendNotification(
        row.student_id,
        'Daily task removed',
        `“${task.title}” was removed by your supervisor.`,
        'general'
      ).catch(() => {});
    }

    await writeAuditLog({
      actorId: req.user.id, action: 'daily_task.delete', entityType: 'daily_task_template',
      entityId: req.params.id, details: { title: task.title, studentCount: assigned.rows.length }, req,
    });

    return res.status(200).json({
      message: assigned.rows.length === 1
        ? 'Task deleted for 1 trainee.'
        : `Task deleted for ${assigned.rows.length} trainees.`,
      id: task.id,
    });
  } catch (error) {
    console.error('Delete daily task error:', error);
    return res.status(500).json({ message: 'Unable to delete the task.' });
  }
};

export { TASK_STATUSES, ensureDailyTaskTables, manilaDate };
