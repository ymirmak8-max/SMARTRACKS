import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';
import { ensureDailyTaskTables } from './dailyTaskController.js';

const MIN_RADIUS = 10;
const MAX_RADIUS = 5000;
const ATTENDANCE_MODES = new Set(['fixed', 'field', 'remote']);

const supervisesDeployment = (alias, param) => `(
  ${alias}.supervisor_id = ${param}
  OR (${alias}.supervisor_id IS NULL AND ${alias}.company_id = (SELECT company_id FROM users WHERE id = ${param}))
)`;

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
};

const parseRadius = (value) => {
  const radius = Math.round(Number(value));
  return Number.isFinite(radius) && radius >= MIN_RADIUS && radius <= MAX_RADIUS ? radius : null;
};

const parseCoordinates = (latitude, longitude) => {
  if ((latitude === '' || latitude == null) && (longitude === '' || longitude == null))
    return { latitude: null, longitude: null };
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
};

const manilaToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const dateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

const addDays = (key, amount) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

export const loadSupervisorCompanyIds = async (supervisorId) => {
  const result = await pool.query(
    `SELECT DISTINCT company_id FROM (
       SELECT d.company_id FROM deployments d
       WHERE d.status = 'active' AND d.supervisor_id = $1 AND d.company_id IS NOT NULL
       UNION
       SELECT u.company_id FROM users u WHERE u.id = $1 AND u.company_id IS NOT NULL
     ) owned`,
    [supervisorId]
  );
  return result.rows.map((row) => row.company_id).filter(Boolean);
};

const loadOwnedLocation = async (locationId, companyIds) => {
  if (!companyIds.length) return null;
  const result = await pool.query(
    `SELECT * FROM company_locations
     WHERE id = $1 AND is_active = true AND company_id = ANY($2::uuid[])`,
    [locationId, companyIds]
  );
  return result.rows[0] || null;
};

const attachToSupervisorTrainees = async (locationId, companyId, supervisorId) => {
  const result = await pool.query(
    `INSERT INTO deployment_locations (deployment_id, location_id, is_primary)
     SELECT d.id, $1, false FROM deployments d
     WHERE d.status = 'active' AND d.company_id = $2 AND ${supervisesDeployment('d', '$3')}
     ON CONFLICT (deployment_id, location_id) DO NOTHING
     RETURNING deployment_id`,
    [locationId, companyId, supervisorId]
  );
  return result.rows.length;
};

const detachFromSupervisorTrainees = async (locationId, supervisorId) => {
  await pool.query(
    `DELETE FROM deployment_locations dl
     USING deployments d
     WHERE dl.deployment_id = d.id AND dl.location_id = $1 AND dl.is_primary = false
       AND ${supervisesDeployment('d', '$2')}`,
    [locationId, supervisorId]
  );
};

// GET /api/supervisor/workplaces
export const getWorkplaces = async (req, res) => {
  try {
    const companyIds = await loadSupervisorCompanyIds(req.user.id);
    if (!companyIds.length) return res.status(200).json({ companies: [] });
    const result = await pool.query(
      `SELECT c.id, c.name, c.address, c.latitude, c.longitude, c.geo_radius_meters,
         COALESCE(json_agg(json_build_object(
           'id', cl.id, 'name', cl.name, 'address', cl.address,
           'latitude', cl.latitude, 'longitude', cl.longitude,
           'geo_radius_meters', cl.geo_radius_meters, 'attendance_mode', cl.attendance_mode,
           'is_primary', cl.is_primary, 'assigned_count', counts.assigned_count,
           'my_trainee_count', counts.my_trainee_count
         ) ORDER BY cl.is_primary DESC, cl.name) FILTER (WHERE cl.id IS NOT NULL), '[]'::json) AS locations
       FROM companies c
       LEFT JOIN company_locations cl ON cl.company_id = c.id AND cl.is_active = true
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS assigned_count,
           COUNT(*) FILTER (
             WHERE d.supervisor_id = $2 OR (d.supervisor_id IS NULL AND d.company_id = sup.company_id)
           )::int AS my_trainee_count
         FROM deployment_locations dl
         JOIN deployments d ON d.id = dl.deployment_id AND d.status = 'active'
         LEFT JOIN users sup ON sup.id = $2
         WHERE dl.location_id = cl.id
       ) counts ON true
       WHERE c.id = ANY($1::uuid[])
       GROUP BY c.id
       ORDER BY c.name`,
      [companyIds, req.user.id]
    );
    const companies = result.rows.map((company) => ({ ...company, locations: parseJsonArray(company.locations) }));
    return res.status(200).json({ companies });
  } catch (error) {
    console.error('Get supervisor workplaces error:', error);
    return res.status(500).json({ message: 'Unable to load your company workplaces.' });
  }
};

// POST /api/supervisor/workplaces
export const createWorkplace = async (req, res) => {
  try {
    const companyIds = await loadSupervisorCompanyIds(req.user.id);
    if (!companyIds.length)
      return res.status(403).json({ message: 'You are not linked to a company yet. Ask your coordinator to assign one.' });
    const companyId = req.body?.companyId || (companyIds.length === 1 ? companyIds[0] : null);
    if (!companyId || !companyIds.includes(companyId))
      return res.status(403).json({ message: 'You can only add workplaces to your own company.' });

    const name = String(req.body?.name || '').trim();
    const address = String(req.body?.address || '').trim();
    const attendanceMode = req.body?.attendanceMode || 'fixed';
    const radius = parseRadius(req.body?.geoRadiusMeters ?? 50);
    const coordinates = parseCoordinates(req.body?.latitude, req.body?.longitude);
    if (!name) return res.status(400).json({ message: 'Enter a name for the sub-workplace.' });
    if (name.length > 255) return res.status(400).json({ message: 'Workplace name must be 255 characters or fewer.' });
    if (!ATTENDANCE_MODES.has(attendanceMode)) return res.status(400).json({ message: 'Choose a valid attendance mode.' });
    if (!radius) return res.status(400).json({ message: `Geofence radius must be between ${MIN_RADIUS} and ${MAX_RADIUS} meters.` });
    if (!coordinates) return res.status(400).json({ message: 'Enter a valid latitude and longitude.' });
    if (attendanceMode === 'fixed' && (coordinates.latitude == null || coordinates.longitude == null))
      return res.status(400).json({ message: 'Pick the workplace location on the map or enter its coordinates.' });

    const inserted = await pool.query(
      `INSERT INTO company_locations
         (company_id, name, address, latitude, longitude, geo_radius_meters, attendance_mode, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING *`,
      [companyId, name, address || null, coordinates.latitude, coordinates.longitude, radius, attendanceMode]
    );
    const location = inserted.rows[0];
    const assignToTrainees = req.body?.assignToTrainees !== false;
    const assigned = assignToTrainees ? await attachToSupervisorTrainees(location.id, companyId, req.user.id) : 0;

    await writeAuditLog({
      actorId: req.user.id, action: 'company_location.create', entityType: 'company_location',
      entityId: location.id, details: { companyId, name, radius, assignedTrainees: assigned, by: 'supervisor' }, req,
    });

    return res.status(201).json({
      message: assigned
        ? `Sub-workplace added. ${assigned} trainee${assigned === 1 ? '' : 's'} can now time in there.`
        : 'Sub-workplace added.',
      location: { ...location, assigned_count: assigned, my_trainee_count: assigned },
    });
  } catch (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message || ''))
      return res.status(409).json({ message: 'Your company already has a workplace with that name.' });
    console.error('Create supervisor workplace error:', error);
    return res.status(500).json({ message: 'Unable to add the sub-workplace.' });
  }
};

// PUT /api/supervisor/workplaces/:id
export const updateWorkplace = async (req, res) => {
  try {
    const companyIds = await loadSupervisorCompanyIds(req.user.id);
    const current = await loadOwnedLocation(req.params.id, companyIds);
    if (!current) return res.status(404).json({ message: 'Workplace not found in your company.' });

    const radius = parseRadius(req.body?.geoRadiusMeters ?? current.geo_radius_meters);
    if (!radius) return res.status(400).json({ message: `Geofence radius must be between ${MIN_RADIUS} and ${MAX_RADIUS} meters.` });

    let name = current.name;
    let address = current.address;
    let latitude = current.latitude;
    let longitude = current.longitude;
    let attendanceMode = current.attendance_mode;
    if (!current.is_primary) {
      if (req.body?.name !== undefined) name = String(req.body.name || '').trim();
      if (req.body?.address !== undefined) address = String(req.body.address || '').trim() || null;
      if (req.body?.attendanceMode !== undefined) attendanceMode = req.body.attendanceMode;
      if (req.body?.latitude !== undefined || req.body?.longitude !== undefined) {
        const coordinates = parseCoordinates(req.body.latitude, req.body.longitude);
        if (!coordinates) return res.status(400).json({ message: 'Enter a valid latitude and longitude.' });
        latitude = coordinates.latitude;
        longitude = coordinates.longitude;
      }
      if (!name) return res.status(400).json({ message: 'Enter a name for the sub-workplace.' });
      if (!ATTENDANCE_MODES.has(attendanceMode)) return res.status(400).json({ message: 'Choose a valid attendance mode.' });
      if (attendanceMode === 'fixed' && (latitude == null || longitude == null))
        return res.status(400).json({ message: 'A fixed workplace needs a location on the map.' });
    }

    const updated = await pool.query(
      `UPDATE company_locations
       SET name = $1, address = $2, latitude = $3, longitude = $4,
           geo_radius_meters = $5, attendance_mode = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [name, address, latitude, longitude, radius, attendanceMode, current.id]
    );
    const location = updated.rows[0];
    if (location.is_primary) {
      await pool.query('UPDATE companies SET geo_radius_meters = $1 WHERE id = $2', [radius, location.company_id]);
    }

    if (!location.is_primary && typeof req.body?.assignToTrainees === 'boolean') {
      if (req.body.assignToTrainees) await attachToSupervisorTrainees(location.id, location.company_id, req.user.id);
      else await detachFromSupervisorTrainees(location.id, req.user.id);
    }

    await writeAuditLog({
      actorId: req.user.id, action: 'company_location.update', entityType: 'company_location',
      entityId: location.id,
      details: { name: location.name, radius, previousRadius: current.geo_radius_meters, by: 'supervisor' }, req,
    });

    return res.status(200).json({
      message: radius !== Number(current.geo_radius_meters)
        ? `Geofence for ${location.name} is now ${radius} m.`
        : `${location.name} updated.`,
      location,
    });
  } catch (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message || ''))
      return res.status(409).json({ message: 'Your company already has a workplace with that name.' });
    console.error('Update supervisor workplace error:', error);
    return res.status(500).json({ message: 'Unable to update the workplace.' });
  }
};

// DELETE /api/supervisor/workplaces/:id
export const removeWorkplace = async (req, res) => {
  try {
    const companyIds = await loadSupervisorCompanyIds(req.user.id);
    const current = await loadOwnedLocation(req.params.id, companyIds);
    if (!current) return res.status(404).json({ message: 'Workplace not found in your company.' });
    if (current.is_primary)
      return res.status(409).json({ message: 'The main workplace cannot be removed. Ask your coordinator to change it.' });

    const blockers = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE d.primary_location_id = $1)::int AS primary_count,
         COUNT(*) FILTER (
           WHERE NOT (
             d.supervisor_id IS NOT DISTINCT FROM $2::uuid
             OR (d.supervisor_id IS NULL AND d.company_id IS NOT DISTINCT FROM sup.company_id)
           )
         )::int AS other_count
       FROM deployments d
       LEFT JOIN users sup ON sup.id = $2
       WHERE d.status = 'active'
         AND (
           d.primary_location_id = $1
           OR EXISTS (SELECT 1 FROM deployment_locations dl WHERE dl.deployment_id = d.id AND dl.location_id = $1)
         )`,
      [current.id, req.user.id]
    );
    const { primary_count: primaryCount = 0, other_count: otherCount = 0 } = blockers.rows[0] || {};
    if (Number(primaryCount) > 0)
      return res.status(409).json({ message: 'A trainee uses this as their main workplace. Ask your coordinator to reassign them first.' });
    if (Number(otherCount) > 0)
      return res.status(409).json({ message: 'Trainees of another supervisor use this workplace. Ask your coordinator to remove it.' });

    await detachFromSupervisorTrainees(current.id, req.user.id);
    await pool.query(
      'UPDATE company_locations SET is_active = false, updated_at = NOW() WHERE id = $1 AND is_primary = false',
      [current.id]
    );

    await writeAuditLog({
      actorId: req.user.id, action: 'company_location.archive', entityType: 'company_location',
      entityId: current.id, details: { name: current.name, by: 'supervisor' }, req,
    });

    return res.status(200).json({ message: `${current.name} was removed.` });
  } catch (error) {
    console.error('Remove supervisor workplace error:', error);
    return res.status(500).json({ message: 'Unable to remove the workplace.' });
  }
};

const buildMissedDays = ({ records, exceptions, workDays, startDate, endDate, lookbackDays = 30 }) => {
  const today = manilaToday();
  const recorded = new Set(records.map((record) => dateKey(record.date)));
  const scheduled = new Set((Array.isArray(workDays) && workDays.length ? workDays : [1, 2, 3, 4, 5]).map(Number));
  const covered = (key) => exceptions.some((item) => dateKey(item.date_from) <= key && key <= dateKey(item.date_to));
  const earliest = addDays(today, -lookbackDays);
  const start = startDate && dateKey(startDate) > earliest ? dateKey(startDate) : earliest;
  const last = endDate && dateKey(endDate) < today ? addDays(dateKey(endDate), 1) : today;
  const missed = [];
  for (let key = start; key < last; key = addDays(key, 1)) {
    const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
    if (scheduled.has(weekday) && !recorded.has(key) && !covered(key)) missed.push(key);
  }
  return missed.reverse();
};

// GET /api/supervisor/students/:studentId/activity
export const getStudentActivity = async (req, res) => {
  try {
    const deploymentResult = await pool.query(
      `SELECT d.id AS deployment_id, d.student_id, d.company_id, d.required_hours, d.start_date, d.end_date,
              d.work_days, d.work_start_time, d.work_end_time, d.late_grace_minutes,
              u.first_name, u.last_name, u.email, u.course, u.school, u.profile_picture,
              c.name AS company_name, cl.name AS worksite_name
       FROM deployments d
       JOIN users u ON u.id = d.student_id
       LEFT JOIN companies c ON c.id = d.company_id
       LEFT JOIN company_locations cl ON cl.id = d.primary_location_id
       WHERE d.student_id = $1 AND d.status = 'active' AND ${supervisesDeployment('d', '$2')}
       LIMIT 1`,
      [req.params.studentId, req.user.id]
    );
    const deployment = deploymentResult.rows[0];
    if (!deployment) return res.status(404).json({ message: 'This trainee is not assigned to you.' });

    const recordsResult = await pool.query(
      `SELECT tr.id, tr.date::text AS date, tr.clock_in, tr.clock_out, tr.total_hours, tr.is_valid,
              tr.anomaly_flag, tr.is_late, tr.late_minutes,
              tr.selfie_in_url, tr.selfie_out_url, tr.evidence_url, tr.evidence_note,
              tr.clock_in_lat, tr.clock_in_lng, tr.clock_out_lat, tr.clock_out_lng,
              cin.name AS clock_in_worksite, cout.name AS clock_out_worksite
       FROM time_records tr
       LEFT JOIN company_locations cin ON cin.id = tr.clock_in_location_id
       LEFT JOIN company_locations cout ON cout.id = tr.clock_out_location_id
       WHERE tr.student_id = $1
       ORDER BY tr.date DESC, tr.clock_in DESC NULLS LAST
       LIMIT 60`,
      [deployment.student_id]
    );
    const records = recordsResult.rows;

    const exceptionsResult = await pool.query(
      `SELECT exception_type, date_from::text AS date_from, date_to::text AS date_to, reason
       FROM attendance_exceptions
       WHERE status = 'approved'
         AND (
           (student_id = $1 AND exception_type = 'leave')
           OR (exception_type IN ('holiday', 'closure') AND (company_id IS NULL OR company_id = $2))
         )
         AND date_to >= (CURRENT_DATE - 45)
       ORDER BY date_from DESC`,
      [deployment.student_id, deployment.company_id]
    ).catch(() => ({ rows: [] }));
    const exceptions = exceptionsResult.rows;

    const totalsResult = await pool.query(
      `SELECT COALESCE(SUM(total_hours) FILTER (WHERE is_valid = true), 0) AS hours_rendered,
              COUNT(*) FILTER (WHERE clock_in IS NOT NULL)::int AS days_present,
              COUNT(*) FILTER (WHERE is_late = true)::int AS days_late,
              COUNT(*) FILTER (WHERE anomaly_flag IS NOT NULL)::int AS days_flagged
       FROM time_records WHERE student_id = $1`,
      [deployment.student_id]
    );

    let tasks = [];
    try {
      await ensureDailyTaskTables();
      const tasksResult = await pool.query(
        `SELECT a.id, a.status, a.student_notes, a.completed_at, a.excuse_remarks, a.updated_at,
                t.title, t.description, t.task_date::text AS task_date
         FROM daily_task_assignments a
         JOIN daily_task_templates t ON t.id = a.template_id
         WHERE a.student_id = $1 AND t.task_date >= (CURRENT_DATE - 45)
         ORDER BY t.task_date DESC, t.created_at DESC
         LIMIT 100`,
        [deployment.student_id]
      );
      tasks = tasksResult.rows;
    } catch (taskError) {
      console.error('Load activity tasks error:', taskError.message);
    }

    const totals = totalsResult.rows[0] || {};
    const missedDays = buildMissedDays({
      records, exceptions, workDays: deployment.work_days,
      startDate: deployment.start_date, endDate: deployment.end_date,
    });

    return res.status(200).json({
      student: deployment,
      totals: {
        hoursRendered: Number(totals.hours_rendered || 0),
        requiredHours: Number(deployment.required_hours || 0),
        daysPresent: Number(totals.days_present || 0),
        daysLate: Number(totals.days_late || 0),
        daysFlagged: Number(totals.days_flagged || 0),
        daysMissed: missedDays.length,
      },
      records,
      missedDays,
      exceptions,
      tasks,
    });
  } catch (error) {
    console.error('Get student activity error:', error);
    return res.status(500).json({ message: 'Unable to load this trainee’s activity.' });
  }
};

export const __test__ = { buildMissedDays, parseRadius, parseCoordinates };
