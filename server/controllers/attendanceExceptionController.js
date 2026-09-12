import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';
import { calculateCreditedHours } from '../utils/attendanceHours.js';
import { sendNotification } from './notificationController.js';

const REQUEST_TYPES = ['leave', 'correction'];
const CALENDAR_TYPES = ['holiday', 'closure'];
const validDateRange = (from, to) => /^\d{4}-\d{2}-\d{2}$/.test(from || '')
  && /^\d{4}-\d{2}-\d{2}$/.test(to || '') && to >= from;
const validTime = value => value == null || value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const timestampFor = (date, time) => time
  ? new Date(`${date}T${time}:00${process.env.APP_UTC_OFFSET || '+08:00'}`)
  : null;

export const getMyExceptions = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ae.*, reviewer.first_name AS reviewer_first, reviewer.last_name AS reviewer_last
      FROM attendance_exceptions ae
      LEFT JOIN users reviewer ON reviewer.id = ae.reviewed_by
      LEFT JOIN deployments d ON d.student_id = $1 AND d.status = 'active'
      WHERE ae.student_id = $1
         OR (ae.status = 'approved' AND ae.exception_type IN ('holiday', 'closure')
             AND (ae.company_id IS NULL OR ae.company_id = d.company_id))
      ORDER BY ae.date_from DESC, ae.created_at DESC
    `, [req.user.id]);
    return res.status(200).json({ exceptions: result.rows });
  } catch (error) {
    console.error('Get attendance exceptions error:', error);
    return res.status(500).json({ message: 'Failed to load attendance exceptions.' });
  }
};

export const createRequest = async (req, res) => {
  try {
    const { type, dateFrom, dateTo, reason, evidenceUrl, proposedClockIn, proposedClockOut } = req.body;
    if (!REQUEST_TYPES.includes(type))
      return res.status(400).json({ message: 'Request type must be leave or attendance correction.' });
    if (!validDateRange(dateFrom, dateTo || dateFrom) || !reason?.trim())
      return res.status(400).json({ message: 'Valid dates and a reason are required.' });
    if (!validTime(proposedClockIn) || !validTime(proposedClockOut))
      return res.status(400).json({ message: 'Proposed attendance times must use HH:MM format.' });
    if (type === 'correction' && (dateTo || dateFrom) !== dateFrom)
      return res.status(400).json({ message: 'An attendance correction must cover one date only.' });
    if (type === 'correction' && !proposedClockIn && !proposedClockOut)
      return res.status(400).json({ message: 'Provide a proposed time in, time out, or both.' });
    const duplicate = await pool.query(`
      SELECT id FROM attendance_exceptions
      WHERE student_id = $1 AND status = 'pending'
        AND daterange(date_from, date_to, '[]') && daterange($2::date, $3::date, '[]')
    `, [req.user.id, dateFrom, dateTo || dateFrom]);
    if (duplicate.rows.length)
      return res.status(409).json({ message: 'A pending request already overlaps these dates.' });
    const result = await pool.query(`
      INSERT INTO attendance_exceptions
        (exception_type, student_id, date_from, date_to, reason, evidence_url, requested_by, status,
         proposed_clock_in, proposed_clock_out)
      VALUES ($1, $2, $3, $4, $5, $6, $2, 'pending', $7, $8) RETURNING *
    `, [type, req.user.id, dateFrom, dateTo || dateFrom, reason.trim(), evidenceUrl || null,
      proposedClockIn || null, proposedClockOut || null]);
    await writeAuditLog({ actorId: req.user.id, action: 'attendance_exception.request', entityType: 'attendance_exception',
      entityId: result.rows[0].id, details: { type, dateFrom, dateTo: dateTo || dateFrom }, req });
    const reviewers = await pool.query(`
      SELECT DISTINCT coordinator_id AS id FROM deployments
      WHERE student_id = $1 AND status = 'active' AND coordinator_id IS NOT NULL
    `, [req.user.id]);
    await Promise.all(reviewers.rows.map(reviewer => sendNotification(
      reviewer.id, 'Attendance request submitted',
      `${req.user.first_name || 'A student'} submitted a ${type} request for ${dateFrom}.`,
      'attendance_exception'
    )));
    return res.status(201).json({ message: 'Attendance request submitted for review.', request: result.rows[0] });
  } catch (error) {
    console.error('Create attendance request error:', error);
    return res.status(500).json({ message: 'Failed to submit attendance request.' });
  }
};

export const getReviewQueue = async (req, res) => {
  try {
    const params = [];
    const assignmentFilter = req.user.role === 'coordinator'
      ? `AND EXISTS (SELECT 1 FROM deployments d WHERE d.student_id = ae.student_id AND d.coordinator_id = $1 AND d.status = 'active')`
      : '';
    if (req.user.role === 'coordinator') params.push(req.user.id);
    const result = await pool.query(`
      SELECT ae.*, u.first_name, u.last_name, u.email, c.name AS company_name
      FROM attendance_exceptions ae
      JOIN users u ON u.id = ae.student_id
      LEFT JOIN deployments d2 ON d2.student_id = ae.student_id AND d2.status = 'active'
      LEFT JOIN companies c ON c.id = d2.company_id
      WHERE ae.exception_type IN ('leave', 'correction') ${assignmentFilter}
      ORDER BY CASE ae.status WHEN 'pending' THEN 0 ELSE 1 END, ae.created_at DESC
    `, params);
    return res.status(200).json({ requests: result.rows });
  } catch (error) {
    console.error('Get attendance review queue error:', error);
    return res.status(500).json({ message: 'Failed to load attendance requests.' });
  }
};

export const reviewRequest = async (req, res) => {
  const client = await pool.connect();
  try {
    const { decision, remarks } = req.body;
    if (!['approved', 'rejected'].includes(decision))
      return res.status(400).json({ message: 'Decision must be approved or rejected.' });
    const params = [req.params.id, decision, remarks?.trim() || null, req.user.id];
    const accessFilter = req.user.role === 'coordinator'
      ? `AND EXISTS (SELECT 1 FROM deployments d WHERE d.student_id = ae.student_id AND d.coordinator_id = $5 AND d.status = 'active')`
      : '';
    if (req.user.role === 'coordinator') params.push(req.user.id);
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE attendance_exceptions ae
      SET status = $2, review_remarks = $3, reviewed_by = $4, reviewed_at = NOW()
      WHERE ae.id = $1 AND ae.status = 'pending' ${accessFilter}
      RETURNING ae.*
    `, params);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Pending request not found or access denied.' });
    }
    const request = result.rows[0];
    let appliedRecord = null;
    let originalRecord = null;
    if (decision === 'approved' && request.exception_type === 'correction') {
      const existing = await client.query(
        'SELECT * FROM time_records WHERE student_id = $1 AND date = $2 FOR UPDATE',
        [request.student_id, request.date_from]
      );
      originalRecord = existing.rows[0] ? {
        id: existing.rows[0].id,
        clockIn: existing.rows[0].clock_in,
        clockOut: existing.rows[0].clock_out,
        totalHours: existing.rows[0].total_hours,
        isValid: existing.rows[0].is_valid,
        anomalyFlag: existing.rows[0].anomaly_flag,
      } : null;
      const deployment = await client.query(`
        SELECT * FROM deployments WHERE student_id = $1 AND status = 'active'
        ORDER BY created_at DESC LIMIT 1
      `, [request.student_id]);
      if (!deployment.rows.length) throw Object.assign(new Error('The student has no active deployment.'), { status: 409 });
      const clockIn = timestampFor(request.date_from.toISOString?.().slice(0, 10) || String(request.date_from).slice(0, 10),
        request.proposed_clock_in?.slice(0, 5)) || originalRecord?.clockIn;
      const clockOut = timestampFor(request.date_from.toISOString?.().slice(0, 10) || String(request.date_from).slice(0, 10),
        request.proposed_clock_out?.slice(0, 5)) || originalRecord?.clockOut;
      if (!clockIn) throw Object.assign(new Error('A correction must result in a time-in value.'), { status: 409 });
      const hours = clockOut ? calculateCreditedHours({
        clockIn, clockOut,
        workStartTime: deployment.rows[0].work_start_time,
        workEndTime: deployment.rows[0].work_end_time,
      }).creditedHours : null;
      if (existing.rows.length) {
        appliedRecord = (await client.query(`
          UPDATE time_records SET clock_in = $1, clock_out = $2, total_hours = $3,
            is_valid = true, anomaly_flag = NULL
          WHERE id = $4 RETURNING *
        `, [clockIn, clockOut, hours, existing.rows[0].id])).rows[0];
      } else {
        appliedRecord = (await client.query(`
          INSERT INTO time_records (deployment_id, student_id, date, clock_in, clock_out, total_hours, is_valid)
          VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *
        `, [deployment.rows[0].id, request.student_id, request.date_from, clockIn, clockOut, hours])).rows[0];
      }
      await client.query(`
        UPDATE attendance_exceptions SET original_record = $1, applied_record_id = $2 WHERE id = $3
      `, [originalRecord ? JSON.stringify(originalRecord) : null, appliedRecord.id, request.id]);
    }
    await client.query('COMMIT');
    await writeAuditLog({ actorId: req.user.id, action: `attendance_exception.${decision}`,
      entityType: 'attendance_exception', entityId: req.params.id,
      details: { remarks: remarks || null, originalRecord, appliedRecord }, req });
    await sendNotification(request.student_id, `Attendance request ${decision}`,
      decision === 'approved'
        ? 'Your attendance request was approved and any proposed correction was applied.'
        : `Your attendance request was rejected${remarks ? `: ${remarks}` : '.'}`,
      'attendance_exception');
    return res.status(200).json({ message: `Request ${decision}.`, request, appliedRecord });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Review attendance request error:', error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to review attendance request.' });
  } finally {
    client.release();
  }
};

export const createCalendarException = async (req, res) => {
  try {
    const { type, companyId, dateFrom, dateTo, reason } = req.body;
    if (!CALENDAR_TYPES.includes(type) || !validDateRange(dateFrom, dateTo || dateFrom) || !reason?.trim())
      return res.status(400).json({ message: 'Type, valid dates, and description are required.' });
    const result = await pool.query(`
      INSERT INTO attendance_exceptions
        (exception_type, company_id, date_from, date_to, reason, status, requested_by, reviewed_by, reviewed_at)
      VALUES ($1, $2, $3, $4, $5, 'approved', $6, $6, NOW()) RETURNING *
    `, [type, companyId || null, dateFrom, dateTo || dateFrom, reason.trim(), req.user.id]);
    await writeAuditLog({ actorId: req.user.id, action: 'attendance_exception.calendar_create',
      entityType: 'attendance_exception', entityId: result.rows[0].id,
      details: { type, companyId: companyId || null, dateFrom, dateTo: dateTo || dateFrom }, req });
    return res.status(201).json({ message: 'Calendar exception added.', exception: result.rows[0] });
  } catch (error) {
    console.error('Create calendar exception error:', error);
    return res.status(500).json({ message: 'Failed to add calendar exception.' });
  }
};

export const getCalendarExceptions = async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT ae.*, c.name AS company_name
      FROM attendance_exceptions ae
      LEFT JOIN companies c ON c.id = ae.company_id
      WHERE ae.exception_type IN ('holiday', 'closure') AND ae.status = 'approved'
      ORDER BY ae.date_from DESC
    `);
    return res.status(200).json({ exceptions: result.rows });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load calendar exceptions.' });
  }
};
