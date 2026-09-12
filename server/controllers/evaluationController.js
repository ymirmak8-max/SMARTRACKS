import pool from '../config/db.js';
import { writeAuditLog } from '../utils/audit.js';

const REQUIRED_SCORE_KEYS = ['attitude', 'technical', 'communication', 'teamwork', 'initiative', 'quality'];

// GET /api/evaluations/my-students
export const getStudentsForSupervisor = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
  u.id, u.first_name, u.last_name, u.email, u.course, u.school,
  d.id AS deployment_id, d.required_hours, d.start_date, d.end_date,
  c.name AS company_name,
        COALESCE(SUM(tr.total_hours), 0) AS hours_rendered,
        (SELECT json_agg(e.*) FROM evaluations e WHERE e.deployment_id = d.id) AS evaluations
      FROM deployments d
      JOIN users u ON d.student_id = u.id
      JOIN companies c ON d.company_id = c.id
      LEFT JOIN time_records tr ON tr.student_id = u.id AND tr.is_valid = true
      WHERE d.supervisor_id = $1 AND d.status = 'active'
      GROUP BY u.id, u.first_name, u.last_name, u.email,
               d.id, d.required_hours, d.start_date, d.end_date, c.name
      ORDER BY u.last_name ASC
    `, [req.user.id]);

    return res.status(200).json({ students: result.rows });
  } catch (err) {
    console.error('Get supervisor students error:', err);
    return res.status(500).json({ message: 'Failed to fetch students.' });
  }
};

// POST /api/evaluations/submit
export const submitEvaluation = async (req, res) => {
  try {
    const { deploymentId, period, scores, comments } = req.body;

    if (!deploymentId || !period || !scores)
      return res.status(400).json({ message: 'Deployment ID, period, and scores are required.' });

    const validPeriods = ['midterm', 'final'];
    if (!validPeriods.includes(period))
      return res.status(400).json({ message: 'Period must be midterm or final.' });

    const assignment = await pool.query(
      `SELECT id FROM deployments
       WHERE id = $1 AND supervisor_id = $2 AND status = 'active'`,
      [deploymentId, req.user.id]
    );
    if (assignment.rows.length === 0)
      return res.status(403).json({ message: 'This deployment is not assigned to you.' });

    const scoreKeys = scores && typeof scores === 'object' && !Array.isArray(scores) ? Object.keys(scores) : [];
    if (scoreKeys.length !== REQUIRED_SCORE_KEYS.length || REQUIRED_SCORE_KEYS.some(key => !scoreKeys.includes(key)))
      return res.status(400).json({ message: 'A score is required for every evaluation criterion.' });
    const scoreValues = REQUIRED_SCORE_KEYS.map(key => Number(scores[key]));
    if (scoreValues.some(score => !Number.isFinite(score) || score < 0 || score > 100))
      return res.status(400).json({ message: 'Scores must be numbers from 0 to 100.' });

    // Enforce the same sequence shown in the supervisor dashboard and reject duplicates.
    const existing = await pool.query(
      `SELECT id, period FROM evaluations WHERE deployment_id = $1`,
      [deploymentId]
    );

    if (existing.rows.some(evaluation => evaluation.period === period))
      return res.status(409).json({ message: `${period} evaluation already submitted.` });
    if (period === 'final' && !existing.rows.some(evaluation => evaluation.period === 'midterm'))
      return res.status(409).json({ message: 'Submit the midterm evaluation before the final evaluation.' });

    // Calculate total score (average of all criteria)
    const totalScore = parseFloat(
      (scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(2)
    );

    const result = await pool.query(`
      INSERT INTO evaluations (deployment_id, supervisor_id, period, scores, total_score, comments)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [deploymentId, req.user.id, period, JSON.stringify(scores), totalScore, comments || null]);

    await writeAuditLog({ actorId: req.user.id, action: 'evaluation.submit', entityType: 'evaluation',
      entityId: result.rows[0].id, details: { deploymentId, period, totalScore }, req });

    return res.status(201).json({
      message: `${period} evaluation submitted successfully.`,
      evaluation: result.rows[0],
    });
  } catch (err) {
    console.error('Submit evaluation error:', err);
    if (err.code === '23505')
      return res.status(409).json({ message: `${req.body.period} evaluation already submitted.` });
    return res.status(500).json({ message: 'Failed to submit evaluation.' });
  }
};

// GET /api/evaluations/:deploymentId
export const getEvaluations = async (req, res) => {
  try {
    const { deploymentId } = req.params;

    if (req.user.role === 'supervisor' || req.user.role === 'coordinator') {
      const ownerColumn = req.user.role === 'supervisor' ? 'supervisor_id' : 'coordinator_id';
      const assignment = await pool.query(
        `SELECT id FROM deployments WHERE id = $1 AND ${ownerColumn} = $2`,
        [deploymentId, req.user.id]
      );
      if (assignment.rows.length === 0)
        return res.status(403).json({ message: 'This deployment is not assigned to you.' });
    }

    const result = await pool.query(`
      SELECT e.*, u.first_name AS supervisor_first, u.last_name AS supervisor_last
      FROM evaluations e
      JOIN users u ON e.supervisor_id = u.id
      WHERE e.deployment_id = $1
      ORDER BY e.submitted_at DESC
    `, [deploymentId]);

    return res.status(200).json({ evaluations: result.rows });
  } catch (err) {
    console.error('Get evaluations error:', err);
    return res.status(500).json({ message: 'Failed to fetch evaluations.' });
  }
};
