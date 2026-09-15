import pool from '../config/db.js';
import { sendNotification } from './notificationController.js';
import { DOCUMENT_TYPES, persistUpload } from '../utils/storage.js';
import { writeAuditLog } from '../utils/audit.js';

const parseRequirementPayload = body => {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim() || null;
  const deadlineValue = body.deadlineDaysBeforeOjt;
  const deadlineDaysBeforeOjt = deadlineValue === '' || deadlineValue == null ? null : Number(deadlineValue);
  const sortOrder = body.sortOrder === '' || body.sortOrder == null ? 0 : Number(body.sortOrder);
  if (!name || name.length > 255)
    throw Object.assign(new Error('Requirement name must be between 1 and 255 characters.'), { status: 400 });
  if (description && description.length > 2000)
    throw Object.assign(new Error('Description must be 2,000 characters or fewer.'), { status: 400 });
  if (deadlineDaysBeforeOjt != null && (!Number.isInteger(deadlineDaysBeforeOjt) || deadlineDaysBeforeOjt < 0 || deadlineDaysBeforeOjt > 365))
    throw Object.assign(new Error('Deadline offset must be a whole number from 0 to 365.'), { status: 400 });
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000)
    throw Object.assign(new Error('Display order must be a whole number from 0 to 10,000.'), { status: 400 });
  return { name, description, deadlineDaysBeforeOjt, sortOrder, isRequired: body.isRequired !== false };
};

// GET /api/documents/requirements
export const getRequirements = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM document_requirements
      ${req.user.role === 'student' ? 'WHERE is_active = true' : ''}
      ORDER BY sort_order ASC, name ASC
    `);
    return res.status(200).json({ requirements: result.rows });
  } catch (err) {
    console.error('Get requirements error:', err);
    return res.status(500).json({ message: 'Failed to fetch requirements.' });
  }
};

// GET /api/documents/my-documents
// GET /api/documents/student/:studentId
export const getStudentDocuments = async (req, res) => {
  try {
    const studentId = req.params.studentId || req.user.id;

    if (req.user.role === 'coordinator' && req.params.studentId) {
      const assignment = await pool.query(
        `SELECT 1 FROM deployments WHERE student_id = $1 AND status = 'active'`,
        [studentId]
      );
      if (!assignment.rows.length)
        return res.status(404).json({ message: 'Student not found or access denied.' });
    }

    const requirements = await pool.query(
      `SELECT * FROM document_requirements requirement
       WHERE requirement.is_active = true
          OR EXISTS (
            SELECT 1 FROM student_documents existing
            WHERE existing.requirement_id = requirement.id AND existing.student_id = $1
          )
       ORDER BY requirement.sort_order ASC, requirement.name ASC`,
      [studentId]
    );

    const documents = await pool.query(
      `SELECT sd.*, u.first_name AS reviewer_first, u.last_name AS reviewer_last
       FROM student_documents sd
       LEFT JOIN users u ON sd.reviewed_by = u.id
       WHERE sd.student_id = $1`,
      [studentId]
    );

    // Map documents to requirements
    const mapped = requirements.rows.map(req => {
      const doc = documents.rows.find(d => d.requirement_id === req.id);
      return {
        requirement: req,
        document: doc || null,
      };
    });

    return res.status(200).json({ documents: mapped });
  } catch (err) {
    console.error('Get documents error:', err);
    return res.status(500).json({ message: 'Failed to fetch documents.' });
  }
};

// POST /api/documents/upload
export const uploadDocument = async (req, res) => {
  try {
    const { requirementId, fileUrl, fileName } = req.body;
    const studentId = req.user.id;

    if (!requirementId || !fileUrl)
      return res.status(400).json({ message: 'Requirement ID and file are required.' });
    const locked = await pool.query(
      'SELECT 1 FROM deployments WHERE student_id = $1 AND records_locked_at IS NOT NULL LIMIT 1',
      [studentId]
    );
    if (locked.rows.length)
      return res.status(423).json({ message: 'This completed deployment is locked.' });

    // Check if requirement exists
    const req_check = await pool.query(
      `SELECT * FROM document_requirements WHERE id = $1`, [requirementId]
    );
    if (req_check.rows.length === 0)
      return res.status(404).json({ message: 'Requirement not found.' });

    const storedFileUrl = await persistUpload(fileUrl, {
      folder: 'documents', ownerId: studentId, allowedTypes: DOCUMENT_TYPES, maxBytes: 8 * 1024 * 1024,
    });

    // Check if already submitted
    const existing = await pool.query(
      `SELECT * FROM student_documents WHERE student_id = $1 AND requirement_id = $2`,
      [studentId, requirementId]
    );

    let result;
    if (existing.rows.length > 0) {
      // Update existing submission
      result = await pool.query(
        `UPDATE student_documents
         SET file_url = $1, status = 'pending', submitted_at = NOW(),
             remarks = NULL, reviewed_at = NULL, reviewed_by = NULL
         WHERE student_id = $2 AND requirement_id = $3
         RETURNING *`,
        [storedFileUrl, studentId, requirementId]
      );
    } else {
      // New submission
      result = await pool.query(
        `INSERT INTO student_documents (student_id, requirement_id, file_url, status, submitted_at)
         VALUES ($1, $2, $3, 'pending', NOW())
         RETURNING *`,
        [studentId, requirementId, storedFileUrl]
      );
    }

    await writeAuditLog({ actorId: studentId, action: 'document.submit', entityType: 'student_document',
      entityId: result.rows[0].id, details: { requirementId }, req });

    return res.status(201).json({
      message: 'Document submitted successfully.',
      document: result.rows[0],
    });
  } catch (err) {
    console.error('Upload document error:', err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to upload document.' });
  }
};

// PATCH /api/documents/:docId/review
export const reviewDocument = async (req, res) => {
  try {
    const { docId } = req.params;
    const { status, remarks } = req.body;

    const validStatuses = ['approved', 'returned'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ message: 'Invalid status.' });

    const result = await pool.query(
      `UPDATE student_documents
       SET status = $1, remarks = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4
         AND NOT EXISTS (
           SELECT 1 FROM deployments locked
           WHERE locked.student_id = student_documents.student_id
             AND locked.records_locked_at IS NOT NULL
         )
         AND ($5::boolean = false OR EXISTS (
           SELECT 1 FROM deployments d
           WHERE d.student_id = student_documents.student_id
             AND d.coordinator_id = $3 AND d.status = 'active'
         ))
       RETURNING *`,
      [status, remarks || null, req.user.id, docId, false]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Document not found.' });

    await writeAuditLog({ actorId: req.user.id, action: `document.${status}`, entityType: 'student_document',
      entityId: docId, details: { studentId: result.rows[0].student_id, remarks: remarks || null }, req });

    // Notify student
    try {
      const { sendNotification } = await import('./notificationController.js');
      const doc = result.rows[0];
      await sendNotification(
        doc.student_id,
        status === 'approved' ? '✅ Document Approved' : '❌ Document Returned',
        status === 'approved'
          ? 'Your document has been approved by the coordinator.'
          : `Your document was returned for revision. ${remarks ? 'Remarks: ' + remarks : ''}`,
        'document'
      );
    } catch (notifErr) {
      console.error('Notification error:', notifErr);
    }

    return res.status(200).json({
      message: `Document ${status} successfully.`,
      document: result.rows[0],
    });
  } catch (err) {
    console.error('Review document error:', err);
    return res.status(500).json({ message: 'Failed to review document.' });
  }
};

// POST /api/documents/requirements
export const createRequirement = async (req, res) => {
  try {
    const { name, description, isRequired, deadlineDaysBeforeOjt, sortOrder } = parseRequirementPayload(req.body);
    const duplicate = await pool.query('SELECT 1 FROM document_requirements WHERE LOWER(name) = LOWER($1)', [name]);
    if (duplicate.rows.length)
      return res.status(409).json({ message: 'A requirement with this name already exists.' });

    const result = await pool.query(
      `INSERT INTO document_requirements (name, description, is_required, deadline_days_before_ojt, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, description, isRequired, deadlineDaysBeforeOjt, sortOrder]
    );

    await writeAuditLog({ actorId: req.user.id, action: 'document_requirement.create',
      entityType: 'document_requirement', entityId: result.rows[0].id, details: { name }, req });

    return res.status(201).json({
      message: 'Requirement created successfully.',
      requirement: result.rows[0],
    });
  } catch (err) {
    console.error('Create requirement error:', err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to create requirement.' });
  }
};

export const updateRequirement = async (req, res) => {
  try {
    const { name, description, isRequired, deadlineDaysBeforeOjt, sortOrder } = parseRequirementPayload(req.body);
    const duplicate = await pool.query(
      'SELECT 1 FROM document_requirements WHERE LOWER(name) = LOWER($1) AND id != $2',
      [name, req.params.requirementId]
    );
    if (duplicate.rows.length)
      return res.status(409).json({ message: 'A requirement with this name already exists.' });
    const result = await pool.query(
      `UPDATE document_requirements
       SET name = $1, description = $2, is_required = $3, deadline_days_before_ojt = $4,
           sort_order = $5, is_active = COALESCE($6, is_active), updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [name, description, isRequired, deadlineDaysBeforeOjt, sortOrder,
        typeof req.body.isActive === 'boolean' ? req.body.isActive : null, req.params.requirementId]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Requirement not found.' });
    await writeAuditLog({ actorId: req.user.id, action: 'document_requirement.update', entityType: 'document_requirement',
      entityId: req.params.requirementId, details: { name, isActive: result.rows[0].is_active }, req });
    return res.status(200).json({ message: 'Requirement updated successfully.', requirement: result.rows[0] });
  } catch (err) {
    console.error('Update requirement error:', err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to update requirement.' });
  }
};

export const archiveRequirement = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE document_requirements SET is_active = false, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.requirementId]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Requirement not found.' });
    const submissions = await pool.query(
      'SELECT COUNT(*)::int AS count FROM student_documents WHERE requirement_id = $1',
      [req.params.requirementId]
    );
    await writeAuditLog({ actorId: req.user.id, action: 'document_requirement.archive', entityType: 'document_requirement',
      entityId: req.params.requirementId, details: { linkedSubmissions: submissions.rows[0].count }, req });
    return res.status(200).json({
      message: submissions.rows[0].count
        ? `Requirement archived; ${submissions.rows[0].count} linked submission${submissions.rows[0].count === 1 ? '' : 's'} retained.`
        : 'Requirement archived successfully.',
      requirement: result.rows[0],
    });
  } catch (err) {
    console.error('Archive requirement error:', err);
    return res.status(500).json({ message: 'Failed to archive requirement.' });
  }
};
