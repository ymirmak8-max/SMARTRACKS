import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';

const parsePositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const parseCompanyLocation = (latitude, longitude) => {
  if (latitude == null && longitude == null) return { latitude: null, longitude: null };
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
};

const ATTENDANCE_MODES = new Set(['fixed', 'field', 'remote']);
const validateLocation = ({ name, latitude, longitude, geoRadiusMeters, attendanceMode = 'fixed' }) => {
  const location = parseCompanyLocation(latitude, longitude);
  const radius = parsePositiveNumber(geoRadiusMeters ?? 50);
  if (!name?.trim() || !location || !radius || radius > 5000 || !ATTENDANCE_MODES.has(attendanceMode)) return null;
  if (attendanceMode === 'fixed' && (location.latitude == null || location.longitude == null)) return null;
  return { name: name.trim(), ...location, radius, attendanceMode };
};

const validateDeploymentLocations = async (client, companyId, primaryLocationId, locationIds = []) => {
  const requested = [...new Set([primaryLocationId, ...locationIds].filter(Boolean))];
  if (!primaryLocationId) throw Object.assign(new Error('A primary worksite is required.'), { status: 400 });
  const valid = await client.query(
    `SELECT id FROM company_locations WHERE company_id = $1 AND is_active = true AND id = ANY($2::uuid[])`,
    [companyId, requested]
  );
  if (valid.rows.length !== requested.length)
    throw Object.assign(new Error('Every selected worksite must be active and belong to the selected company.'), { status: 400 });
  return requested;
};

const replaceDeploymentLocations = async (client, deploymentId, companyId, primaryLocationId, locationIds = []) => {
  const requested = await validateDeploymentLocations(client, companyId, primaryLocationId, locationIds);
  await client.query('DELETE FROM deployment_locations WHERE deployment_id = $1', [deploymentId]);
  await client.query(
    `INSERT INTO deployment_locations (deployment_id, location_id, is_primary)
     SELECT $1, id, id = $2 FROM company_locations WHERE id = ANY($3::uuid[])`,
    [deploymentId, primaryLocationId, requested]
  );
};

const resolvePrimaryLocationId = async (client, companyId, requestedId) => {
  if (requestedId) return requestedId;
  const result = await client.query(
    `SELECT id FROM company_locations
     WHERE company_id=$1 AND is_active=true ORDER BY is_primary DESC, created_at LIMIT 1`,
    [companyId]
  );
  return result.rows[0]?.id || null;
};

const parseSchedule = ({ workDays, workStartTime, workEndTime, lateGraceMinutes }) => {
  const days = Array.isArray(workDays) ? [...new Set(workDays.map(Number))].sort() : [1, 2, 3, 4, 5];
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  const start = workStartTime || '08:00';
  const end = workEndTime || '17:00';
  const grace = Number(lateGraceMinutes ?? 15);
  if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return null;
  if (!timePattern.test(start) || !timePattern.test(end) || end <= start) return null;
  if (!Number.isInteger(grace) || grace < 0 || grace > 180) return null;
  return { days, start, end, grace };
};

const validateDeploymentUsers = async ({ studentId, supervisorId, coordinatorId }) => {
  const assignments = [
    [studentId, 'student'],
    ...(supervisorId ? [[supervisorId, 'supervisor']] : []),
    ...(coordinatorId ? [[coordinatorId, 'coordinator']] : []),
  ];
  for (const [id, role] of assignments) {
    const result = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND role = $2 AND is_active = true AND approval_status = 'approved'`,
      [id, role]
    );
    if (!result.rows.length) return role;
  }
  return null;
};

// GET /api/deployments/companies
export const getCompanies = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
        COALESCE(json_agg(cl ORDER BY cl.is_primary DESC, cl.name)
          FILTER (WHERE cl.id IS NOT NULL), '[]'::json) AS locations
      FROM companies c
      LEFT JOIN company_locations cl ON cl.company_id = c.id AND cl.is_active = true
      GROUP BY c.id
      ORDER BY c.name ASC
    `);
    return res.status(200).json({ companies: result.rows });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch companies.' });
  }
};

// POST /api/deployments/companies
export const createCompany = async (req, res) => {
  try {
    const { name, address, latitude, longitude, geoRadiusMeters } = req.body;
    const location = parseCompanyLocation(latitude, longitude);
    const radius = parsePositiveNumber(geoRadiusMeters ?? 50);
    if (!name?.trim())
      return res.status(400).json({ message: 'Company name is required.' });
    if (!location || !radius)
      return res.status(400).json({ message: 'Enter valid coordinates and a radius greater than zero.' });

    const result = await pool.query(`
      INSERT INTO companies (name, address, latitude, longitude, geo_radius_meters)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name.trim(), address?.trim() || null, location.latitude, location.longitude, radius]);
    const worksite = await pool.query(`
      INSERT INTO company_locations
        (company_id, name, address, latitude, longitude, geo_radius_meters, attendance_mode, is_primary)
      VALUES ($1, 'Main Worksite', $2, $3, $4, $5, 'fixed', true) RETURNING *
    `, [result.rows[0].id, address?.trim() || null, location.latitude, location.longitude, radius]);

    await writeAuditLog({ actorId: req.user.id, action: 'company.create', entityType: 'company',
      entityId: result.rows[0].id, details: { name: name.trim(), radius }, req });

    return res.status(201).json({ message: 'Company created successfully.',
      company: { ...result.rows[0], locations: worksite.rows } });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create company.' });
  }
};

// PUT /api/deployments/companies/:id
export const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, latitude, longitude, geoRadiusMeters } = req.body;
    const location = parseCompanyLocation(latitude, longitude);
    const radius = parsePositiveNumber(geoRadiusMeters ?? 50);
    if (!name?.trim())
      return res.status(400).json({ message: 'Company name is required.' });
    if (!location || !radius)
      return res.status(400).json({ message: 'Enter valid coordinates and a radius greater than zero.' });

    const result = await pool.query(`
      UPDATE companies
      SET name = $1, address = $2, latitude = $3, longitude = $4, geo_radius_meters = $5
      WHERE id = $6
      RETURNING *
    `, [name.trim(), address?.trim() || null, location.latitude, location.longitude, radius, id]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Company not found.' });
    await pool.query(`
      UPDATE company_locations SET address=$1, latitude=$2, longitude=$3,
        geo_radius_meters=$4, updated_at=NOW()
      WHERE company_id=$5 AND is_primary=true
    `, [address?.trim() || null, location.latitude, location.longitude, radius, id]);

    await writeAuditLog({ actorId: req.user.id, action: 'company.update', entityType: 'company',
      entityId: id, details: { name: name.trim(), radius }, req });

    return res.status(200).json({ message: 'Company updated successfully.', company: result.rows[0] });
  } catch (err) {
    console.error('Update company error:', err);
    return res.status(500).json({ message: 'Failed to update company.' });
  }
};

export const createCompanyLocation = async (req, res) => {
  try {
    const parsed = validateLocation(req.body);
    if (!parsed) return res.status(400).json({ message: 'Enter a worksite name, valid coordinates, radius from 10 to 5000 meters, and attendance mode.' });
    const result = await pool.query(`
      INSERT INTO company_locations
        (company_id, name, address, latitude, longitude, geo_radius_meters, attendance_mode, is_primary)
      SELECT id, $2, $3, $4, $5, $6, $7, false FROM companies WHERE id = $1
      RETURNING *
    `, [req.params.companyId, parsed.name, req.body.address?.trim() || null, parsed.latitude,
      parsed.longitude, parsed.radius, parsed.attendanceMode]);
    if (!result.rows.length) return res.status(404).json({ message: 'Company not found.' });
    await writeAuditLog({ actorId: req.user.id, action: 'company_location.create', entityType: 'company_location',
      entityId: result.rows[0].id, details: { companyId: req.params.companyId, name: parsed.name }, req });
    return res.status(201).json({ message: 'Worksite added.', location: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'This company already has a worksite with that name.' });
    return res.status(500).json({ message: 'Failed to add worksite.' });
  }
};

export const updateCompanyLocation = async (req, res) => {
  const client = await pool.connect();
  try {
    const parsed = validateLocation(req.body);
    if (!parsed) return res.status(400).json({ message: 'Enter valid worksite settings.' });
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM company_locations WHERE id = $1', [req.params.id]);
    if (!current.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Worksite not found.' });
    }
    const makePrimary = Boolean(req.body.isPrimary);
    if (makePrimary) await client.query('UPDATE company_locations SET is_primary = false WHERE company_id = $1', [current.rows[0].company_id]);
    const result = await client.query(`
      UPDATE company_locations SET name=$1, address=$2, latitude=$3, longitude=$4,
        geo_radius_meters=$5, attendance_mode=$6, is_primary=$7, updated_at=NOW()
      WHERE id=$8 RETURNING *
    `, [parsed.name, req.body.address?.trim() || null, parsed.latitude, parsed.longitude, parsed.radius,
      parsed.attendanceMode, makePrimary || current.rows[0].is_primary, req.params.id]);
    if (result.rows[0].is_primary) {
      await client.query(`UPDATE companies SET address=$1, latitude=$2, longitude=$3, geo_radius_meters=$4 WHERE id=$5`,
        [result.rows[0].address, result.rows[0].latitude, result.rows[0].longitude,
          result.rows[0].geo_radius_meters, result.rows[0].company_id]);
    }
    await client.query('COMMIT');
    await writeAuditLog({ actorId: req.user.id, action: 'company_location.update', entityType: 'company_location',
      entityId: req.params.id, details: { name: parsed.name, isPrimary: result.rows[0].is_primary }, req });
    return res.status(200).json({ message: 'Worksite updated.', location: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ message: 'This company already has a worksite with that name.' });
    return res.status(500).json({ message: 'Failed to update worksite.' });
  } finally {
    client.release();
  }
};

export const archiveCompanyLocation = async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE company_locations cl SET is_active=false, updated_at=NOW()
      WHERE cl.id=$1 AND cl.is_primary=false
        AND NOT EXISTS (
          SELECT 1 FROM deployment_locations dl JOIN deployments d ON d.id=dl.deployment_id
          WHERE dl.location_id=cl.id AND d.status='active'
        )
      RETURNING *
    `, [req.params.id]);
    if (!result.rows.length)
      return res.status(409).json({ message: 'Primary or actively assigned worksites cannot be archived.' });
    await writeAuditLog({ actorId: req.user.id, action: 'company_location.archive',
      entityType: 'company_location', entityId: req.params.id, req });
    return res.status(200).json({ message: 'Worksite archived.' });
  } catch {
    return res.status(500).json({ message: 'Failed to archive worksite.' });
  }
};

// GET /api/deployments
export const getDeployments = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        d.*,
        s.first_name AS student_first, s.last_name AS student_last, s.email AS student_email,
        sv.first_name AS supervisor_first, sv.last_name AS supervisor_last,
        co.first_name AS coordinator_first, co.last_name AS coordinator_last,
        c.name AS company_name, cl.name AS primary_location_name, cl.address AS location_address,
        COALESCE(json_agg(json_build_object('id', acl.id, 'name', acl.name, 'isPrimary', dl.is_primary))
          FILTER (WHERE acl.id IS NOT NULL), '[]'::json) AS assigned_locations,
        (
          SELECT clock_in FROM time_records today
          WHERE today.student_id = d.student_id
            AND today.date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
          ORDER BY today.clock_in DESC NULLS LAST LIMIT 1
        ) AS today_clock_in,
        (
          SELECT clock_out FROM time_records today
          WHERE today.student_id = d.student_id
            AND today.date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
          ORDER BY today.clock_in DESC NULLS LAST LIMIT 1
        ) AS today_clock_out
      FROM deployments d
      JOIN users s ON d.student_id = s.id
      LEFT JOIN users sv ON d.supervisor_id = sv.id
      LEFT JOIN users co ON d.coordinator_id = co.id
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN company_locations cl ON cl.id = d.primary_location_id
      LEFT JOIN deployment_locations dl ON dl.deployment_id = d.id
      LEFT JOIN company_locations acl ON acl.id = dl.location_id
      GROUP BY d.id, s.id, sv.id, co.id, c.id, cl.id
      ORDER BY d.created_at DESC
    `);
    return res.status(200).json({ deployments: result.rows });
  } catch (err) {
    console.error('Get deployments error:', err);
    return res.status(500).json({ message: 'Failed to fetch deployments.' });
  }
};

// POST /api/deployments
export const createDeployment = async (req, res) => {
  try {
    const { studentId, supervisorId, coordinatorId: requestedCoordinatorId, companyId, requiredHours, startDate, endDate,
      workDays, workStartTime, workEndTime, lateGraceMinutes, primaryLocationId, locationIds } = req.body;
    const coordinatorId = req.user.role === 'coordinator' ? req.user.id : requestedCoordinatorId;
    const hours = parsePositiveNumber(requiredHours ?? 486);
    const schedule = parseSchedule({ workDays, workStartTime, workEndTime, lateGraceMinutes });

    if (!studentId || !companyId)
      return res.status(400).json({ message: 'Student and company are required.' });
    if (!supervisorId)
      return res.status(400).json({ message: 'Select a supervisor so the student appears in their workspace.' });
    if (!hours)
      return res.status(400).json({ message: 'Required hours must be greater than zero.' });
    if (!schedule)
      return res.status(400).json({ message: 'Enter valid workdays, shift times, and a grace period from 0 to 180 minutes.' });
    if (startDate && endDate && new Date(endDate) < new Date(startDate))
      return res.status(400).json({ message: 'End date cannot be before the start date.' });
    const invalidRole = await validateDeploymentUsers({ studentId, supervisorId, coordinatorId });
    if (invalidRole)
      return res.status(400).json({ message: `Select an active, approved ${invalidRole} for this deployment.` });

    const existing = await pool.query(
      `SELECT id FROM deployments WHERE student_id = $1 AND status = 'active'`,
      [studentId]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ message: 'Student already has an active deployment.' });

    const selectedPrimary = await resolvePrimaryLocationId(pool, companyId, primaryLocationId);
    if (!selectedPrimary)
      return res.status(400).json({ message: 'Add an active worksite to the company before deploying a student.' });
    await validateDeploymentLocations(pool, companyId, selectedPrimary, locationIds);
    const result = await pool.query(`
      INSERT INTO deployments (student_id, supervisor_id, coordinator_id, company_id, required_hours, start_date, end_date,
                               work_days, work_start_time, work_end_time, late_grace_minutes, primary_location_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
      RETURNING *
    `, [studentId, supervisorId || null, coordinatorId || null, companyId, hours, startDate || null, endDate || null,
      schedule.days, schedule.start, schedule.end, schedule.grace, selectedPrimary]);
    await replaceDeploymentLocations(pool, result.rows[0].id, companyId, selectedPrimary, locationIds);

    await writeAuditLog({ actorId: req.user.id, action: 'deployment.create', entityType: 'deployment',
      entityId: result.rows[0].id, details: { studentId, supervisorId, coordinatorId, companyId }, req });
    if (supervisorId) {
      const student = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [studentId]);
      const name = student.rows[0] ? `${student.rows[0].first_name} ${student.rows[0].last_name}` : 'A student';
      const { sendNotification } = await import('./notificationController.js');
      sendNotification(
        supervisorId,
        'New student assigned',
        `${name} is now on your supervision list.`,
        'general'
      ).catch(error => console.error('Supervisor assignment notify error:', error.message));
    }

    return res.status(201).json({ message: 'Deployment created successfully.', deployment: result.rows[0] });
  } catch (err) {
    console.error('Create deployment error:', err);
    if (err.status) return res.status(err.status).json({ message: err.message });
    if (err.code === '23505')
      return res.status(409).json({ message: 'Student already has an active deployment.' });
    return res.status(500).json({ message: 'Failed to create deployment.' });
  }
};

// PUT /api/deployments/:id
export const updateDeployment = async (req, res) => {
  try {
    const { id } = req.params;
    const { supervisorId, coordinatorId: requestedCoordinatorId, companyId, requiredHours, startDate, endDate, status,
      workDays, workStartTime, workEndTime, lateGraceMinutes, primaryLocationId, locationIds } = req.body;
    const hours = parsePositiveNumber(requiredHours ?? 486);
    const schedule = parseSchedule({ workDays, workStartTime, workEndTime, lateGraceMinutes });
    if (!companyId || !hours)
      return res.status(400).json({ message: 'Company and valid required hours are required.' });
    if (!schedule)
      return res.status(400).json({ message: 'Enter valid workdays, shift times, and a grace period from 0 to 180 minutes.' });
    if (!['active', 'completed', 'cancelled'].includes(status || 'active'))
      return res.status(400).json({ message: 'Invalid deployment status.' });
    if (startDate && endDate && new Date(endDate) < new Date(startDate))
      return res.status(400).json({ message: 'End date cannot be before the start date.' });
    const current = await pool.query(
      'SELECT student_id, coordinator_id FROM deployments WHERE id = $1',
      [id]
    );
    if (!current.rows.length) return res.status(404).json({ message: 'Deployment not found.' });
    const coordinatorId = requestedCoordinatorId || current.rows[0].coordinator_id || req.user.id;
    const invalidRole = await validateDeploymentUsers({
      studentId: current.rows[0].student_id, supervisorId, coordinatorId,
    });
    if (invalidRole)
      return res.status(400).json({ message: `Select an active, approved ${invalidRole} for this deployment.` });

    const selectedPrimary = await resolvePrimaryLocationId(pool, companyId, primaryLocationId);
    if (!selectedPrimary)
      return res.status(400).json({ message: 'Select an active primary worksite.' });
    await validateDeploymentLocations(pool, companyId, selectedPrimary, locationIds);
    const result = await pool.query(`
      UPDATE deployments
      SET supervisor_id = $1, coordinator_id = $2, company_id = $3,
          required_hours = $4, start_date = $5, end_date = $6, status = $7,
          work_days = $8, work_start_time = $9, work_end_time = $10, late_grace_minutes = $11,
          primary_location_id = $12
      WHERE id = $13
      RETURNING *
    `, [supervisorId || null, coordinatorId || null, companyId, hours, startDate || null, endDate || null, status || 'active',
      schedule.days, schedule.start, schedule.end, schedule.grace, selectedPrimary, id]);

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Deployment not found.' });
    await replaceDeploymentLocations(pool, id, companyId, selectedPrimary, locationIds);

    await writeAuditLog({ actorId: req.user.id, action: 'deployment.update', entityType: 'deployment',
      entityId: id, details: { supervisorId, coordinatorId, companyId, status: status || 'active' }, req });

    return res.status(200).json({ message: 'Deployment updated successfully.', deployment: result.rows[0] });
  } catch (err) {
    console.error('Update deployment error:', err);
    if (err.status) return res.status(err.status).json({ message: err.message });
    return res.status(500).json({ message: 'Failed to update deployment.' });
  }
};

// GET /api/deployments/options
// Exposes only the account fields required to assign a deployment.
export const getDeploymentOptions = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, first_name, last_name, email, role
      FROM users
      WHERE role IN ('student', 'supervisor', 'coordinator')
        AND is_active = true
        AND approval_status = 'approved'
      ORDER BY role, last_name, first_name
    `);
    return res.status(200).json({ users: result.rows });
  } catch (err) {
    console.error('Get deployment options error:', err);
    return res.status(500).json({ message: 'Failed to fetch deployment options.' });
  }
};
