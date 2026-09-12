import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';

// GET /api/coordinator/students
export const getDeployedStudents = async (req, res) => {
  try {
    const isCoordinator = req.user.role === 'coordinator';
    const coordinatorFilter = isCoordinator ? 'AND (d.coordinator_id = $1 OR d.id IS NULL)' : '';
    const params = isCoordinator ? [req.user.id] : [];
    const result = await pool.query(`
      SELECT 
        u.id, u.first_name, u.last_name, u.email, u.phone,
        d.id AS deployment_id, d.required_hours, d.start_date, d.end_date, d.status,
        c.name AS company_name,
        COALESCE(SUM(tr.total_hours), 0) AS hours_rendered,
        COUNT(CASE WHEN tr.anomaly_flag IS NOT NULL THEN 1 END) AS anomaly_count,
        (SELECT COUNT(*) FROM student_documents sd WHERE sd.student_id = u.id AND sd.status = 'pending') AS pending_documents,
        (SELECT COUNT(*) FROM student_documents sd WHERE sd.student_id = u.id AND sd.status = 'approved') AS approved_documents,
        (SELECT COUNT(*) FROM document_requirements) AS total_requirements
      FROM users u
      LEFT JOIN deployments d ON d.student_id = u.id AND d.status = 'active'
      LEFT JOIN companies c ON d.company_id = c.id
      LEFT JOIN time_records tr ON tr.student_id = u.id AND tr.is_valid = true
      WHERE u.role = 'student'
        AND u.is_active = true
        AND u.approval_status = 'approved'
        ${coordinatorFilter}
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.phone,
               d.id, d.required_hours, d.start_date, d.end_date, d.status, c.name
      ORDER BY (d.id IS NULL) DESC, u.last_name ASC
    `, params);
    return res.status(200).json({ students: result.rows });
  } catch (err) {
    console.error('Get deployed students error:', err);
    return res.status(500).json({ message: 'Failed to fetch students.' });
  }
};

// GET /api/coordinator/students/:studentId
export const getStudentDetail = async (req, res) => {
  try {
    const { studentId } = req.params;

    const coordinatorFilter = req.user.role === 'coordinator' ? 'AND d.coordinator_id = $2' : '';
    const params = req.user.role === 'coordinator' ? [studentId, req.user.id] : [studentId];
    const student = await pool.query(`
  SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
         u.course, u.school,
         d.id AS deployment_id, d.required_hours, d.start_date, d.end_date,
         c.name AS company_name, c.address AS company_address
  FROM users u
  JOIN deployments d ON d.student_id = u.id
  JOIN companies c ON d.company_id = c.id
  WHERE u.id = $1 AND u.role = 'student' ${coordinatorFilter}
`, params);

    if (student.rows.length === 0)
      return res.status(404).json({ message: 'Student not found.' });

    const dtr = await pool.query(`
      SELECT * FROM time_records WHERE student_id = $1 ORDER BY date DESC LIMIT 30
    `, [studentId]);

    const documents = await pool.query(`
      SELECT sd.*, dr.name AS requirement_name
      FROM student_documents sd
      JOIN document_requirements dr ON sd.requirement_id = dr.id
      WHERE sd.student_id = $1
    `, [studentId]);

    const evaluations = await pool.query(`
      SELECT e.*, u.first_name AS supervisor_first, u.last_name AS supervisor_last
      FROM evaluations e
      JOIN users u ON e.supervisor_id = u.id
      WHERE e.deployment_id = $1
      ORDER BY e.submitted_at DESC
    `, [student.rows[0].deployment_id]);

    const totalHours = dtr.rows
      .filter(record => record.is_valid)
      .reduce((sum, record) => sum + parseFloat(record.total_hours || 0), 0);

    return res.status(200).json({
      student: student.rows[0],
      dtr: dtr.rows,
      documents: documents.rows,
      evaluations: evaluations.rows,
      totalHours: parseFloat(totalHours.toFixed(2)),
    });
  } catch (err) {
    console.error('Get student detail error:', err);
    return res.status(500).json({ message: 'Failed to fetch student detail.' });
  }
};

// GET /api/coordinator/anomalies
export const getAnomalyReport = async (req, res) => {
  try {
    const coordinatorFilter = req.user.role === 'coordinator' ? 'AND d.coordinator_id = $1' : '';
    const params = req.user.role === 'coordinator' ? [req.user.id] : [];
    const result = await pool.query(`
      SELECT 
        tr.id, tr.date, tr.clock_in, tr.clock_out, tr.anomaly_flag,
        tr.clock_in_lat, tr.clock_in_lng, tr.total_hours,
        u.first_name, u.last_name, u.email,
        c.name AS company_name
      FROM time_records tr
      JOIN users u ON tr.student_id = u.id
      JOIN deployments d ON tr.deployment_id = d.id
      JOIN companies c ON d.company_id = c.id
      WHERE tr.anomaly_flag IS NOT NULL ${coordinatorFilter}
      ORDER BY tr.date DESC
      LIMIT 50
    `, params);
    return res.status(200).json({ anomalies: result.rows });
  } catch (err) {
    console.error('Get anomalies error:', err);
    return res.status(500).json({ message: 'Failed to fetch anomaly report.' });
  }
};

// POST /api/coordinator/announcements
export const createAnnouncement = async (req, res) => {
  try {
    const { title, body, targetRole } = req.body;

    if (!title || !body)
      return res.status(400).json({ message: 'Title and body are required.' });

    const result = await pool.query(`
      INSERT INTO announcements (created_by, title, body, target_role)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [req.user.id, title, body, targetRole || null]);

    await writeAuditLog({ actorId: req.user.id, action: 'announcement.create', entityType: 'announcement',
      entityId: result.rows[0].id, details: { targetRole: targetRole || null }, req });

    const notifyUsers = async () => {
      try {
        const { sendNotification } = await import('./notificationController.js');
        let usersResult;
        if (targetRole) {
          usersResult = await pool.query(
            `SELECT id FROM users WHERE role = $1 AND is_active = true`, [targetRole]
          );
        } else {
          usersResult = await pool.query(`SELECT id FROM users WHERE is_active = true`);
        }
        await Promise.all(usersResult.rows.map(user =>
          sendNotification(user.id, `Announcement: ${title}`, body, 'announcement')
        ));
      } catch (err) {
        console.error('Notification error:', err);
      }
    };

    await notifyUsers();

    return res.status(201).json({
      message: 'Announcement created successfully.',
      announcement: {
        ...result.rows[0],
        first_name: req.user.first_name,
        last_name: req.user.last_name,
      },
    });
  } catch (err) {
    console.error('Create announcement error:', err);
    return res.status(500).json({ message: 'Failed to create announcement.' });
  }
};

// GET /api/coordinator/announcements
export const getAnnouncements = async (req, res) => {
  try {
    const userRole = req.user.role;
    const result = await pool.query(`
      SELECT a.*, u.first_name, u.last_name
      FROM announcements a
      JOIN users u ON a.created_by = u.id
      WHERE a.target_role IS NULL OR a.target_role = $1 OR a.created_by = $2
      ORDER BY a.created_at DESC
      LIMIT 20
    `, [userRole, req.user.id]);
    return res.status(200).json({ announcements: result.rows });
  } catch (err) {
    console.error('Get announcements error:', err);
    return res.status(500).json({ message: 'Failed to fetch announcements.' });
  }
};

// GET /api/coordinator/attendance-review
export const getAttendanceReview = async (req, res) => {
  try {
    const ownerColumn = req.user.role === 'supervisor' ? 'supervisor_id' : 'coordinator_id';
    const assignmentFilter = req.user.role === 'admin' ? '' : `AND d.${ownerColumn} = $1`;
    const params = req.user.role === 'admin' ? [] : [req.user.id];
    const result = await pool.query(`
      SELECT tr.id, tr.student_id, tr.date, tr.clock_in, tr.clock_out,
             tr.clock_in_lat, tr.clock_in_lng, tr.clock_out_lat, tr.clock_out_lng,
             tr.selfie_in_url, tr.selfie_out_url, tr.total_hours, tr.is_valid,
             tr.anomaly_flag, tr.is_late, tr.late_minutes,
             u.first_name, u.last_name, u.email, c.name AS company_name
      FROM time_records tr
      JOIN users u ON u.id = tr.student_id
      JOIN deployments d ON d.id = tr.deployment_id
      JOIN companies c ON c.id = d.company_id
      WHERE d.status = 'active' ${assignmentFilter}
      ORDER BY (tr.anomaly_flag IS NOT NULL) DESC, tr.date DESC, tr.clock_in DESC
      LIMIT 200
    `, params);
    return res.status(200).json({ records: result.rows });
  } catch (error) {
    console.error('Get attendance review error:', error);
    return res.status(500).json({ message: 'Failed to load attendance records.' });
  }
};

// PATCH /api/coordinator/attendance-review/:recordId
export const reviewAttendanceRecord = async (req, res) => {
  try {
    const { decision, remarks } = req.body;
    if (!['approved', 'rejected'].includes(decision))
      return res.status(400).json({ message: 'Decision must be approved or rejected.' });
    if (decision === 'rejected' && !String(remarks || '').trim())
      return res.status(400).json({ message: 'A reason is required when rejecting attendance.' });

    const ownerColumn = req.user.role === 'supervisor' ? 'supervisor_id' : 'coordinator_id';
    const assignmentFilter = req.user.role === 'admin' ? '' : `AND d.${ownerColumn} = $2`;
    const params = req.user.role === 'admin' ? [req.params.recordId] : [req.params.recordId, req.user.id];
    const existing = await pool.query(`
      SELECT tr.id, tr.student_id, tr.anomaly_flag
      FROM time_records tr JOIN deployments d ON d.id = tr.deployment_id
      WHERE tr.id = $1 AND d.status = 'active' ${assignmentFilter}
    `, params);
    if (!existing.rows.length)
      return res.status(404).json({ message: 'Attendance record not found in your assignments.' });

    const originalFlag = existing.rows[0].anomaly_flag;
    const rejectionFlag = `[REJECTED] ${String(remarks).trim()}`;
    const result = await pool.query(
      `UPDATE time_records
       SET is_valid = $1, anomaly_flag = $2
       WHERE id = $3
       RETURNING *`,
      [decision === 'approved', decision === 'approved' ? null : rejectionFlag, req.params.recordId]
    );
    await writeAuditLog({
      actorId: req.user.id,
      action: `attendance.review_${decision}`,
      entityType: 'time_record',
      entityId: req.params.recordId,
      details: { studentId: existing.rows[0].student_id, originalFlag, remarks: String(remarks || '').trim() || null },
      req,
    });
    return res.status(200).json({ message: `Attendance ${decision}.`, record: result.rows[0] });
  } catch (error) {
    console.error('Review attendance record error:', error);
    return res.status(500).json({ message: 'Failed to review attendance record.' });
  }
};
