import pool from '../config/db.js';
import { IMAGE_TYPES, persistUpload } from '../utils/storage.js';
import { writeAuditLog } from '../utils/audit.js';
import { calculateCreditedHours } from '../utils/attendanceHours.js';
import { consumeAttendanceChallenge } from '../utils/attendanceChallenge.js';
import { sendNotification } from './notificationController.js';

// Helper: calculate distance between 2 GPS coordinates in meters
const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const publishLiveLocation = async (studentId, coordinates, accuracy, isClockedIn) => {
  const parsedAccuracy = accuracy == null ? null : Number(accuracy);
  await pool.query(`
    INSERT INTO student_locations (student_id, latitude, longitude, accuracy, is_clocked_in, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (student_id) DO UPDATE SET
      latitude = $2, longitude = $3, accuracy = $4,
      is_clocked_in = $5, updated_at = NOW()
  `, [studentId, coordinates.latitude, coordinates.longitude,
    Number.isFinite(parsedAccuracy) ? parsedAccuracy : null, Boolean(isClockedIn)]);
};

const parseCoordinates = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)
    return null;
  return { latitude: lat, longitude: lng };
};

const getBusinessDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(value);

const findTodayRecord = async (studentId, today = getBusinessDate()) => {
  const result = await pool.query(
    `SELECT * FROM time_records
     WHERE student_id = $1
       AND (
         date = $2::date
         OR (clock_in AT TIME ZONE 'Asia/Manila')::date = $2::date
       )
     ORDER BY clock_in DESC NULLS LAST
     LIMIT 1`,
    [studentId, today]
  );
  return result.rows[0] || null;
};

const alreadyTimedInPayload = (record) => ({
  message: 'You are already timed in today.',
  record,
  isValid: record.is_valid,
  anomalyFlag: record.anomaly_flag,
  alreadyRecorded: true,
  receipt: {
    receiptId: record.clock_in_submission_id,
    action: 'clock_in',
    serverReceivedAt: record.clock_in_received_at,
    capturedAt: record.clock_in,
    worksite: null,
    gpsAccuracy: null,
    status: record.is_valid ? 'accepted' : 'flagged',
  },
});

const DEFAULT_POLICY = { selfieRequired: true, maximumGpsAccuracyMeters: 100, unpaidBreakMinutes: 60,
  maximumCreditedHours: 8, offlineSubmissionHours: 24 };
const GPS_RECORDING_LIMIT_METERS = 250;
const appendAnomaly = (current, next) => (current ? `${current} | ${next}` : next);
const getAttendancePolicy = async () => {
  const result = await pool.query("SELECT value FROM system_settings WHERE key = 'attendance_policy'").catch(() => ({ rows: [] }));
  const policy = { ...DEFAULT_POLICY, ...(result.rows[0]?.value || {}) };
  const meters = Number(policy.maximumGpsAccuracyMeters);
  policy.maximumGpsAccuracyMeters = Number.isFinite(meters) ? Math.max(100, meters) : 100;
  return policy;
};

const parseSubmissionMetadata = (clientCapturedAt, submissionId, policy) => {
  const capturedAt = new Date(clientCapturedAt);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!Number.isFinite(capturedAt.getTime()) || !uuidPattern.test(String(submissionId || ''))) return null;
  const ageMs = Date.now() - capturedAt.getTime();
  if (ageMs < -5 * 60_000 || ageMs > 7 * 24 * 60 * 60_000) return null;
  return { capturedAt, delayed: ageMs > Number(policy.offlineSubmissionHours) * 60 * 60_000,
    delayHours: Math.max(0, ageMs / 3_600_000) };
};

const getBusinessTimeParts = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Manila',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { weekday: weekdayMap[values.weekday], minutes: Number(values.hour) * 60 + Number(values.minute) };
};

const getDeploymentWithLocations = async (studentId) => {
  const result = await pool.query(`
    SELECT d.*, c.name AS company_name,
      COALESCE(json_agg(json_build_object(
        'id', cl.id, 'name', cl.name, 'address', cl.address,
        'latitude', cl.latitude, 'longitude', cl.longitude,
        'geoRadiusMeters', cl.geo_radius_meters, 'attendanceMode', cl.attendance_mode,
        'isPrimary', dl.is_primary
      ) ORDER BY dl.is_primary DESC, cl.name) FILTER (WHERE cl.id IS NOT NULL), '[]'::json) AS locations
    FROM deployments d
    JOIN companies c ON c.id=d.company_id
    LEFT JOIN deployment_locations dl ON dl.deployment_id=d.id
    LEFT JOIN company_locations cl ON cl.id=dl.location_id AND cl.is_active=true
    WHERE d.student_id=$1 AND d.status='active'
    GROUP BY d.id, c.id
  `, [studentId]);
  const deployment = result.rows[0];
  if (!deployment) return null;
  if (typeof deployment.locations === 'string') {
    try { deployment.locations = JSON.parse(deployment.locations); }
    catch { deployment.locations = []; }
  }
  if (!Array.isArray(deployment.locations)) deployment.locations = [];
  return deployment;
};

export const classifyWorksitePosition = (locations, coordinates, accuracy = 0) => {
  const gpsAccuracy = Math.max(0, Number(accuracy) || 0);
  const candidates = (locations || []).filter(location =>
    Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude))
  ).map(location => ({
    ...location,
    distance: getDistanceMeters(coordinates.latitude, coordinates.longitude,
      Number(location.latitude), Number(location.longitude)),
    radius: Number(location.geoRadiusMeters || 50),
  })).sort((a, b) => a.distance - b.distance);
  const nearest = candidates[0] || null;
  const matched = candidates.find(location =>
    location.attendanceMode !== 'fixed' || location.distance + gpsAccuracy <= location.radius
  ) || null;
  if (matched) return { state: 'inside', matched, uncertain: null, nearest };
  const uncertain = candidates.find(location =>
    location.attendanceMode === 'fixed'
    && Math.max(0, location.distance - gpsAccuracy) <= location.radius
    && location.distance + gpsAccuracy > location.radius
  ) || null;
  return { state: uncertain ? 'uncertain' : 'outside', matched: null, uncertain, nearest };
};

export const notifyAttendanceAnomaly = async (studentId, anomalyFlag) => {
  if (!studentId || !anomalyFlag) return 0;
  try {
    const result = await pool.query(`
      SELECT student.first_name, student.last_name,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT reviewer_id), NULL) AS reviewer_ids
      FROM users student
      LEFT JOIN deployments d ON d.student_id = student.id AND d.status = 'active'
      LEFT JOIN LATERAL (
        VALUES (d.coordinator_id), (d.supervisor_id)
      ) reviewers(reviewer_id) ON true
      WHERE student.id = $1
      GROUP BY student.id, student.first_name, student.last_name
    `, [studentId]);
    if (!result.rows.length) return 0;
    const student = result.rows[0];
    const recipients = [...new Set(student.reviewer_ids || [])];
    await Promise.all(recipients.map(recipientId => sendNotification(
      recipientId,
      'Attendance anomaly detected',
      `${student.first_name} ${student.last_name}: ${anomalyFlag}`,
      'anomaly'
    )));
    return recipients.length;
  } catch (error) {
    console.error('Attendance anomaly notification error:', error.message);
    return 0;
  }
};

// POST /api/dtr/clock-in
export const clockIn = async (req, res) => {
  try {
    const { latitude, longitude, accuracy, selfieUrl, clientCapturedAt, submissionId, attendanceChallenge } = req.body;
    const studentId = req.user.id;
    const policy = await getAttendancePolicy();

    const coordinates = parseCoordinates(latitude, longitude);
    if (!coordinates)
      return res.status(400).json({ message: 'Valid GPS coordinates are required.' });
    if (policy.selfieRequired && !selfieUrl) return res.status(400).json({ message: 'A selfie is required.' });
    if (!Number.isFinite(Number(accuracy)) || Number(accuracy) < 0 || Number(accuracy) > GPS_RECORDING_LIMIT_METERS)
      return res.status(400).json({ message: `GPS is too vague (±${Math.round(Number(accuracy) || 0)}m). A position within ±${GPS_RECORDING_LIMIT_METERS}m is required.` });
    const submission = parseSubmissionMetadata(clientCapturedAt, submissionId, policy);
    if (!submission) return res.status(400).json({ message: 'Valid attendance capture metadata is required.' });

    const duplicate = await pool.query('SELECT * FROM time_records WHERE clock_in_submission_id = $1', [submissionId]);
    if (duplicate.rows.length)
      return res.status(200).json({ message: 'Time-in already synchronized.', record: duplicate.rows[0], isValid: duplicate.rows[0].is_valid, anomalyFlag: duplicate.rows[0].anomaly_flag });

    const dep = await getDeploymentWithLocations(studentId);
    if (!dep)
      return res.status(404).json({ message: 'No active deployment found.' });
    if (dep.records_locked_at)
      return res.status(423).json({ message: 'This completed deployment is locked.' });

    const today = getBusinessDate(submission.capturedAt);
    const existing = await findTodayRecord(studentId, today);
    if (existing?.clock_in)
      return res.status(200).json(alreadyTimedInPayload(existing));

    let isValid = true;
    let anomalyFlag = null;
    if (submission.delayed) {
      isValid = false;
      anomalyFlag = `Offline time-in synchronized ${Math.round(submission.delayHours)}h after capture`;
    }
    const businessTime = getBusinessTimeParts(submission.capturedAt);
    const scheduledDays = Array.isArray(dep.work_days) ? dep.work_days.map(Number) : [1, 2, 3, 4, 5];
    const [startHour, startMinute] = String(dep.work_start_time || '08:00').split(':').map(Number);
    const scheduledStartMinutes = startHour * 60 + startMinute;
    const isLate = scheduledDays.includes(businessTime.weekday)
      && businessTime.minutes > scheduledStartMinutes + Number(dep.late_grace_minutes || 0);
    const lateMinutes = isLate ? businessTime.minutes - scheduledStartMinutes : 0;

    const worksite = classifyWorksitePosition(dep.locations, coordinates, accuracy);
    if (!worksite.matched) {
      isValid = false;
      anomalyFlag = worksite.uncertain
        ? `GPS uncertainty overlaps ${worksite.uncertain.name} boundary (distance ${Math.round(worksite.uncertain.distance)}m, accuracy +/-${Math.round(Number(accuracy))}m, radius ${Math.round(worksite.uncertain.radius)}m)`
        : worksite.nearest
          ? `Time-in outside approved worksites (${Math.round(worksite.nearest.distance)}m from ${worksite.nearest.name})`
          : 'Time-in has no configured approved worksite';
    }
    if (Number(accuracy) > Number(policy.maximumGpsAccuracyMeters)) {
      isValid = false;
      anomalyFlag = appendAnomaly(anomalyFlag,
        `Low GPS accuracy (+/-${Math.round(Number(accuracy))}m). The device location was still recorded.`);
    }

    const storedSelfieUrl = await persistUpload(selfieUrl, {
      folder: 'attendance/selfies', ownerId: studentId, allowedTypes: IMAGE_TYPES, maxBytes: 3 * 1024 * 1024,
    });
    const worksiteId = (worksite.matched || worksite.uncertain)?.id || null;
    const result = existing
      ? await pool.query(
        `UPDATE time_records
         SET deployment_id = $1, clock_in = $2, clock_in_device_at = $2, clock_in_received_at = NOW(),
             clock_in_submission_id = $3, clock_in_lat = $4, clock_in_lng = $5, selfie_in_url = $6,
             is_valid = $7, anomaly_flag = $8, is_late = $9, late_minutes = $10, clock_in_location_id = $11
         WHERE id = $12 AND clock_in IS NULL
         RETURNING *`,
        [dep.id, submission.capturedAt, submissionId, coordinates.latitude, coordinates.longitude,
         storedSelfieUrl, isValid, anomalyFlag, isLate, lateMinutes, worksiteId, existing.id]
      )
      : await pool.query(
        `INSERT INTO time_records
         (deployment_id, student_id, clock_in, clock_in_device_at, clock_in_received_at,
          clock_in_submission_id, clock_in_lat, clock_in_lng, selfie_in_url,
          is_valid, anomaly_flag, date, is_late, late_minutes, clock_in_location_id)
         VALUES ($1, $2, $3, $3, NOW(), $4, $5, $6, $7, $8, $9, $10::date, $11, $12, $13)
         RETURNING *`,
        [dep.id, studentId, submission.capturedAt, submissionId, coordinates.latitude, coordinates.longitude,
         storedSelfieUrl, isValid, anomalyFlag, today, isLate, lateMinutes, worksiteId]
      );
    const saved = result.rows[0] || await findTodayRecord(studentId, today);
    if (!saved?.clock_in)
      return res.status(409).json({ message: 'Time-in could not be saved. Please try again.' });
    await consumeAttendanceChallenge(studentId, 'clock_in', attendanceChallenge).catch(() => false);

    await publishLiveLocation(studentId, coordinates, accuracy, true).catch(error =>
      console.error('Failed to publish live location after time-in:', error));

    await writeAuditLog({ actorId: studentId, action: 'attendance.clock_in', entityType: 'time_record',
      entityId: saved.id, details: { isValid, anomalyFlag, isLate, lateMinutes,
        worksiteId, geofenceState: worksite.state }, req });
    if (anomalyFlag) await notifyAttendanceAnomaly(studentId, anomalyFlag);

    return res.status(201).json({
      message: isValid ? 'Timed in successfully.' : worksite.state === 'uncertain'
        ? 'Timed in and sent for review because GPS uncertainty overlaps the worksite boundary.'
        : 'Timed in but flagged - outside office perimeter.',
      record: saved,
      isValid,
      anomalyFlag,
      isLate,
      lateMinutes,
      receipt: {
        receiptId: submissionId,
        action: 'clock_in',
        serverReceivedAt: saved.clock_in_received_at,
        capturedAt: saved.clock_in,
        worksite: (worksite.matched || worksite.uncertain)?.name || null,
        gpsAccuracy: Number(accuracy),
        status: isValid ? 'accepted' : 'flagged',
      },
    });
  } catch (err) {
    console.error('Clock-in error:', err);
    if (err.code === '23505') {
      const recorded = await findTodayRecord(req.user.id).catch(() => null);
      if (recorded?.clock_in) return res.status(200).json(alreadyTimedInPayload(recorded));
    }
    return res.status(err.status || 500).json({
      message: err.status && err.message ? err.message : 'Failed to time in. Please try again.',
    });
  }
};

// POST /api/dtr/clock-out
export const clockOut = async (req, res) => {
  try {
    const { latitude, longitude, accuracy, selfieUrl, evidenceUrl, evidenceNote, clientCapturedAt, submissionId, attendanceChallenge } = req.body;
    const studentId = req.user.id;
    const policy = await getAttendancePolicy();

    const coordinates = parseCoordinates(latitude, longitude);
    if (!coordinates)
      return res.status(400).json({ message: 'Valid GPS coordinates are required.' });
    if (policy.selfieRequired && !selfieUrl) return res.status(400).json({ message: 'A selfie is required.' });
    if (!Number.isFinite(Number(accuracy)) || Number(accuracy) < 0 || Number(accuracy) > GPS_RECORDING_LIMIT_METERS)
      return res.status(400).json({ message: `GPS is too vague (±${Math.round(Number(accuracy) || 0)}m). A position within ±${GPS_RECORDING_LIMIT_METERS}m is required.` });
    const submission = parseSubmissionMetadata(clientCapturedAt, submissionId, policy);
    if (!submission) return res.status(400).json({ message: 'Valid attendance capture metadata is required.' });

    const duplicate = await pool.query('SELECT * FROM time_records WHERE clock_out_submission_id = $1', [submissionId]);
    if (duplicate.rows.length)
      return res.status(200).json({ message: 'Time-out already synchronized.', record: duplicate.rows[0], totalHours: Number(duplicate.rows[0].total_hours || 0) });
    if (!await consumeAttendanceChallenge(studentId, 'clock_out', attendanceChallenge))
      return res.status(409).json({ code: 'ATTENDANCE_CHALLENGE_INVALID',
        message: 'The attendance verification expired or was already used. Start the time-out process again.' });

    const today = getBusinessDate(submission.capturedAt);
    const existingRecord = await findTodayRecord(studentId, today);

    if (!existingRecord?.clock_in)
      return res.status(400).json({ message: 'No time-in record was found for today.' });

    if (existingRecord.clock_out)
      return res.status(400).json({ message: 'You have already timed out today.' });

    const record = existingRecord;

    const clockOutTime = submission.capturedAt;

    const dep = await getDeploymentWithLocations(studentId);

    let isValid = record.is_valid;
    let anomalyFlag = record.anomaly_flag;
    if (submission.delayed) {
      isValid = false;
      anomalyFlag = (anomalyFlag ? `${anomalyFlag} | ` : '') +
        `Offline time-out synchronized ${Math.round(submission.delayHours)}h after capture`;
    }

    let clockOutWorksite = null;
    if (dep) {
      if (dep.records_locked_at)
        return res.status(423).json({ message: 'This completed deployment is locked.' });
      const worksite = classifyWorksitePosition(dep.locations, coordinates, accuracy);
      clockOutWorksite = worksite.matched || worksite.uncertain;
      if (!worksite.matched) {
        isValid = false;
        anomalyFlag = (anomalyFlag ? `${anomalyFlag} | ` : '') + (worksite.uncertain
          ? `GPS uncertainty overlaps ${worksite.uncertain.name} boundary (distance ${Math.round(worksite.uncertain.distance)}m, accuracy +/-${Math.round(Number(accuracy))}m, radius ${Math.round(worksite.uncertain.radius)}m)`
          : worksite.nearest
            ? `Time-out outside approved worksites (${Math.round(worksite.nearest.distance)}m from ${worksite.nearest.name})`
            : 'Time-out has no configured approved worksite');
      }
    }
    if (Number(accuracy) > Number(policy.maximumGpsAccuracyMeters)) {
      isValid = false;
      anomalyFlag = appendAnomaly(anomalyFlag,
        `Low GPS accuracy (+/-${Math.round(Number(accuracy))}m). The device location was still recorded.`);
    }

    const hours = calculateCreditedHours({
      clockIn: record.clock_in,
      clockOut: clockOutTime,
      workStartTime: dep?.work_start_time,
      workEndTime: dep?.work_end_time,
      unpaidBreakMinutes: policy.unpaidBreakMinutes,
      maximumCreditedHours: policy.maximumCreditedHours,
    });
    const totalHours = hours.creditedHours;
    if (hours.unusuallyLong) {
      isValid = false;
      anomalyFlag = (anomalyFlag ? `${anomalyFlag} | ` : '') +
        `Unusually long shift (${hours.elapsedHours}h elapsed; ${hours.scheduledNetHours}h scheduled)`;
    }

    const [storedSelfieUrl, storedEvidenceUrl] = await Promise.all([
      persistUpload(selfieUrl, { folder: 'attendance/selfies', ownerId: studentId, allowedTypes: IMAGE_TYPES, maxBytes: 3 * 1024 * 1024 }),
      persistUpload(evidenceUrl, { folder: 'attendance/evidence', ownerId: studentId, allowedTypes: IMAGE_TYPES, maxBytes: 5 * 1024 * 1024 }),
    ]);
    const result = await pool.query(
      `UPDATE time_records
       SET clock_out = $1, clock_out_device_at = $1, clock_out_received_at = NOW(),
           clock_out_submission_id = $2, clock_out_lat = $3, clock_out_lng = $4,
           selfie_out_url = $5, total_hours = $6, is_valid = $7, anomaly_flag = $8,
           evidence_url = $9, evidence_note = $10, clock_out_location_id = $11
       WHERE id = $12
       RETURNING *`,
      [submission.capturedAt, submissionId, coordinates.latitude, coordinates.longitude, storedSelfieUrl,
       totalHours, isValid, anomalyFlag, storedEvidenceUrl, evidenceNote?.trim().slice(0, 1000) || null,
       clockOutWorksite?.id || null, record.id]
    );

    await publishLiveLocation(studentId, coordinates, accuracy, false).catch(error =>
      console.error('Failed to finalize live location status:', error));

    await writeAuditLog({ actorId: studentId, action: 'attendance.clock_out', entityType: 'time_record',
      entityId: record.id, details: { isValid, anomalyFlag, totalHours, elapsedHours: hours.elapsedHours, breakMinutes: hours.breakMinutes }, req });
    if (anomalyFlag && anomalyFlag !== record.anomaly_flag)
      await notifyAttendanceAnomaly(studentId, anomalyFlag);

    return res.status(200).json({
      message: 'Timed out successfully.',
      record: result.rows[0],
      totalHours,
      receipt: {
        receiptId: submissionId,
        action: 'clock_out',
        serverReceivedAt: result.rows[0].clock_out_received_at,
        capturedAt: result.rows[0].clock_out,
        worksite: clockOutWorksite?.name || null,
        gpsAccuracy: Number(accuracy),
        status: result.rows[0].is_valid ? 'accepted' : 'flagged',
      },
    });
  } catch (err) {
    console.error('Clock-out error:', err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to time out.' });
  }
};

// GET /api/dtr/today
export const getTodayRecord = async (req, res) => {
  try {
    return res.status(200).json({ record: await findTodayRecord(req.user.id) });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch today record.' });
  }
};

// GET /api/dtr/history
export const getDTRHistory = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM time_records WHERE student_id = $1 ORDER BY date DESC LIMIT 30`,
      [req.user.id]
    );

    const totals = await pool.query(
      `SELECT COALESCE(SUM(total_hours), 0) AS total_rendered
       FROM time_records WHERE student_id = $1 AND is_valid = true`,
      [req.user.id]
    );

    const deployment = await pool.query(
      `SELECT required_hours FROM deployments WHERE student_id = $1 AND status = 'active'`,
      [req.user.id]
    );

    return res.status(200).json({
      records: result.rows,
      totalRendered: parseFloat(totals.rows[0].total_rendered),
      requiredHours: deployment.rows[0]?.required_hours || 486,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch DTR history.' });
  }
};

// GET /api/dtr/deployment-info
export const getDeploymentInfo = async (req, res) => {
  try {
    const [deployment, attendancePolicy] = await Promise.all([
      getDeploymentWithLocations(req.user.id),
      getAttendancePolicy(),
    ]);
    if (!deployment)
      return res.status(404).json({ message: 'No active deployment found.' });
    const primary = deployment.locations.find(location => location.isPrimary) || deployment.locations[0] || {};
    return res.status(200).json({ deployment: {
      ...deployment,
      latitude: primary.latitude,
      longitude: primary.longitude,
      geo_radius_meters: primary.geoRadiusMeters,
      address: primary.address,
      worksite_name: primary.name,
      attendance_mode: primary.attendanceMode,
    }, attendancePolicy });
  } catch (err) {
    console.error('Get deployment info error:', err);
    return res.status(500).json({ message: 'Failed to fetch deployment info.' });
  }
  };
  // POST /api/dtr/flag-exit
export const flagPerimeterExit = async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    const studentId = req.user.id;
    const today = getBusinessDate();
    const coordinates = parseCoordinates(latitude, longitude);
    const parsedAccuracy = Number(accuracy);
    const policy = await getAttendancePolicy();
    if (!coordinates || !Number.isFinite(parsedAccuracy) || parsedAccuracy < 0 || parsedAccuracy > GPS_RECORDING_LIMIT_METERS)
      return res.status(400).json({ message: `A current GPS position within ±${GPS_RECORDING_LIMIT_METERS}m is required.` });
  
    const record = await findTodayRecord(studentId, today);
    if (!record?.clock_in || record.clock_out)
      return res.status(200).json({ message: 'Not timed in; no flag is needed.' });
    const deployment = await getDeploymentWithLocations(studentId);
    if (!deployment?.locations?.length)
      return res.status(409).json({ message: 'The deployment geofence is not configured.' });
    const worksite = classifyWorksitePosition(deployment.locations, coordinates, parsedAccuracy);
    if (worksite.matched)
      return res.status(200).json({ message: `Current position is accepted at ${worksite.matched.name}.` });
    if (worksite.uncertain)
      return res.status(200).json({ message: `GPS uncertainty overlaps ${worksite.uncertain.name}; monitoring will continue without flagging an exit.` });
    const distance = Math.round(worksite.nearest.distance);
    const existingFlag = record.anomaly_flag || '';
    if (existingFlag.includes('Left perimeter during shift'))
      return res.status(200).json({ message: 'Exit was already flagged.' });
    const newFlag = existingFlag
      ? `${existingFlag} | Left perimeter during shift (${distance}m away)`
      : `Left perimeter during shift (${distance}m away)`;

    await pool.query(
      `UPDATE time_records SET anomaly_flag = $1, is_valid = false WHERE id = $2`,
      [newFlag, record.id]
    );

    await writeAuditLog({ actorId: studentId, action: 'attendance.perimeter_exit', entityType: 'time_record',
      entityId: record.id, details: { distance, accuracy: parsedAccuracy }, req });

    await notifyAttendanceAnomaly(studentId, newFlag);

    return res.status(200).json({ message: 'Exit flagged successfully.' });
  } catch (err) {
    console.error('Flag exit error:', err);
    return res.status(500).json({ message: 'Failed to flag exit.' });
  }
  
};// POST /api/dtr/update-location
export const updateLiveLocation = async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    const studentId = req.user.id;
    const coordinates = parseCoordinates(latitude, longitude);
    const parsedAccuracy = accuracy == null ? null : Number(accuracy);
    if (!coordinates || (parsedAccuracy != null && (!Number.isFinite(parsedAccuracy) || parsedAccuracy < 0)))
      return res.status(400).json({ message: 'Valid location data is required.' });

    const openShift = await pool.query(
      `SELECT 1 FROM time_records
       WHERE student_id = $1 AND date = $2 AND clock_in IS NOT NULL AND clock_out IS NULL`,
      [studentId, getBusinessDate()]
    );
    await publishLiveLocation(studentId, coordinates, parsedAccuracy, openShift.rows.length > 0);

    return res.status(200).json({ message: 'Location updated.' });
  } catch (err) {
    console.error('Update location error:', err);
    return res.status(500).json({ message: 'Failed to update location.' });
  }
};

// GET /api/dtr/live-locations
export const getLiveLocations = async (req, res) => {
  try {
    let accessFilter = '';
    const params = [getBusinessDate()];
    if (req.user.role === 'coordinator') {
      accessFilter = 'AND d.coordinator_id = $2';
      params.push(req.user.id);
    } else if (req.user.role === 'supervisor') {
      accessFilter = `AND (
        d.supervisor_id = $2
        OR (d.supervisor_id IS NULL AND d.company_id = (SELECT company_id FROM users WHERE id = $2))
      )`;
      params.push(req.user.id);
    }
    const result = await pool.query(`
      SELECT
        d.student_id,
        COALESCE(sl.latitude, tr.clock_in_lat) AS latitude,
        COALESCE(sl.longitude, tr.clock_in_lng) AS longitude,
        sl.accuracy,
        COALESCE(sl.is_clocked_in, (tr.clock_in IS NOT NULL AND tr.clock_out IS NULL)) AS is_clocked_in,
        COALESCE(sl.updated_at, tr.clock_in) AS updated_at,
        u.first_name, u.last_name, u.email,
        d.company_id,
        c.name AS company_name, cl.name AS worksite_name, cl.latitude AS office_lat,
        cl.longitude AS office_lng, cl.geo_radius_meters,
        tr.clock_in, tr.clock_out, tr.anomaly_flag
      FROM deployments d
      JOIN users u ON u.id = d.student_id
      LEFT JOIN companies c ON c.id = d.company_id
      LEFT JOIN student_locations sl ON sl.student_id = d.student_id
      LEFT JOIN company_locations cl ON cl.id = d.primary_location_id
      LEFT JOIN time_records tr ON tr.student_id = d.student_id AND tr.date = $1
      WHERE d.status = 'active'
        ${accessFilter}
        AND COALESCE(sl.latitude, tr.clock_in_lat) IS NOT NULL
        AND COALESCE(sl.longitude, tr.clock_in_lng) IS NOT NULL
        AND (
          sl.updated_at > NOW() - INTERVAL '30 minutes'
          OR (tr.clock_in IS NOT NULL AND tr.clock_out IS NULL)
        )
      ORDER BY COALESCE(sl.updated_at, tr.clock_in) DESC
    `, params);

    return res.status(200).json({ locations: result.rows });
  } catch (err) {
    console.error('Get live locations error:', err);
    return res.status(500).json({ message: 'Failed to fetch locations.' });
  }
};
