import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';
import { sendNotification } from './notificationController.js';

const readinessQuery = `
  SELECT d.id, d.student_id, d.coordinator_id, d.supervisor_id, d.required_hours, d.completion_status,
         d.completion_requested_at, d.completion_reviewed_at, d.completion_remarks, d.records_locked_at,
         u.first_name, u.last_name, u.email, c.name AS company_name,
         COALESCE((SELECT SUM(tr.total_hours) FROM time_records tr WHERE tr.deployment_id = d.id AND tr.is_valid), 0)::numeric AS rendered_hours,
         (SELECT COUNT(*) FROM document_requirements dr
           WHERE dr.is_required AND dr.is_active)::int AS required_documents,
         (SELECT COUNT(*) FROM student_documents sd JOIN document_requirements dr ON dr.id = sd.requirement_id
           WHERE sd.student_id = d.student_id AND dr.is_required AND dr.is_active
             AND sd.status = 'approved')::int AS approved_documents,
         EXISTS (SELECT 1 FROM evaluations e WHERE e.deployment_id = d.id AND e.period = 'final') AS has_final_evaluation
  FROM deployments d JOIN users u ON u.id = d.student_id LEFT JOIN companies c ON c.id = d.company_id
`;

const withReadiness = row => ({
  ...row,
  rendered_hours: Number(row.rendered_hours),
  ready: Number(row.rendered_hours) >= Number(row.required_hours)
    && row.approved_documents >= row.required_documents && row.has_final_evaluation,
});

export const getMyCompletion = async (req, res) => {
  const result = await pool.query(`${readinessQuery} WHERE d.student_id = $1 AND d.status IN ('active', 'completed')
    ORDER BY d.created_at DESC LIMIT 1`, [req.user.id]);
  if (!result.rows.length) return res.status(404).json({ message: 'No deployment was found.' });
  return res.status(200).json({ completion: withReadiness(result.rows[0]) });
};

export const requestCompletion = async (req, res) => {
  try {
    const current = await pool.query(`${readinessQuery} WHERE d.student_id = $1 AND d.status = 'active'`, [req.user.id]);
    if (!current.rows.length) return res.status(404).json({ message: 'No active deployment was found.' });
    const readiness = withReadiness(current.rows[0]);
    if (!readiness.ready)
      return res.status(409).json({ message: 'Required hours, approved documents, and the final evaluation must be complete first.', completion: readiness });
    if (readiness.completion_status === 'requested')
      return res.status(409).json({ message: 'Completion review has already been requested.' });
    await pool.query(`UPDATE deployments SET completion_status = 'requested', completion_requested_at = NOW(),
      completion_remarks = NULL WHERE id = $1`, [readiness.id]);
    await writeAuditLog({ actorId: req.user.id, action: 'completion.request', entityType: 'deployment', entityId: readiness.id, req });
    if (readiness.coordinator_id) await sendNotification(readiness.coordinator_id, 'Completion review requested',
      `${readiness.first_name} ${readiness.last_name} is ready for OJT completion review.`, 'completion');
    return res.status(200).json({ message: 'Completion review requested.' });
  } catch (error) {
    console.error('Completion request error:', error);
    return res.status(500).json({ message: 'Unable to request completion review.' });
  }
};

export const getCompletionQueue = async (req, res) => {
  try {
    const filter = req.user.role === 'coordinator' ? 'WHERE d.coordinator_id = $1' : 'WHERE true';
    const params = req.user.role === 'coordinator' ? [req.user.id] : [];
    const result = await pool.query(`${readinessQuery} ${filter}
      ORDER BY CASE d.completion_status WHEN 'requested' THEN 0 ELSE 1 END, d.completion_requested_at DESC NULLS LAST`, params);
    return res.status(200).json({ completions: result.rows.map(withReadiness) });
  } catch {
    return res.status(500).json({ message: 'Unable to load completion reviews.' });
  }
};

export const reviewCompletion = async (req, res) => {
  const { decision, remarks } = req.body;
  if (!['approved', 'returned'].includes(decision))
    return res.status(400).json({ message: 'Decision must be approved or returned.' });
  if (decision === 'returned' && !String(remarks || '').trim())
    return res.status(400).json({ message: 'A reason is required when returning a completion request.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const filter = req.user.role === 'coordinator' ? 'AND coordinator_id = $4' : '';
    const params = [
      req.params.id, decision, req.user.id,
      req.user.role === 'coordinator' ? req.user.id : null,
      String(remarks || '').trim() || null,
    ];
    const result = await client.query(`
      UPDATE deployments SET completion_status = $2, completion_reviewed_by = $3,
        completion_reviewed_at = NOW(), completion_remarks = $5,
        status = CASE WHEN $2 = 'approved' THEN 'completed' ELSE status END,
        records_locked_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE records_locked_at END
      WHERE id = $1 AND completion_status = 'requested' ${filter}
      RETURNING *
    `, params);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Requested completion record not found.' });
    }
    await client.query('COMMIT');
    await writeAuditLog({ actorId: req.user.id, action: `completion.${decision}`,
      entityType: 'deployment', entityId: req.params.id, details: { remarks: remarks || null }, req });
    await sendNotification(result.rows[0].student_id, `OJT completion ${decision}`,
      decision === 'approved' ? 'Your OJT completion was approved and official records are now locked.'
        : `Your completion request was returned: ${remarks}`, 'completion');
    return res.status(200).json({ message: `Completion ${decision}.`, deployment: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ message: 'Unable to review completion.' });
  } finally { client.release(); }
};
