import pool from '../config/db.js';

export const getAuditLogs = async (req, res) => {
  try {
    const { search, actor, action, entity_type, from, to, limit = 50, offset = 0 } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (actor) { params.push(actor); where += ` AND a.actor_id = $${params.length}`; }
    if (action) { params.push(action); where += ` AND a.action = $${params.length}`; }
    if (entity_type) { params.push(entity_type); where += ` AND a.entity_type = $${params.length}`; }
    if (from) { params.push(from); where += ` AND a.created_at >= $${params.length}`; }
    if (to) { params.push(to); where += ` AND a.created_at <= $${params.length}`; }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      const ref = `$${params.length}`;
      where += ` AND (a.action ILIKE ${ref} OR a.entity_type ILIKE ${ref} OR a.details::text ILIKE ${ref}
        OR COALESCE(a.user_agent, '') ILIKE ${ref} OR COALESCE(a.ip_address, '') ILIKE ${ref}
        OR COALESCE(u.first_name, '') ILIKE ${ref} OR COALESCE(u.last_name, '') ILIKE ${ref}
        OR COALESCE(u.email, '') ILIKE ${ref})`;
    }

    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 100);
    const safeOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ${where}`, params);
    params.push(safeLimit, safeOffset);
    const query = `SELECT a.id, a.actor_id, a.action, a.entity_type, a.entity_id, a.details,
        a.ip_address, a.user_agent, a.created_at,
        u.first_name AS actor_first_name, u.last_name AS actor_last_name, u.email AS actor_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return res.status(200).json({ logs: result.rows, total: countResult.rows[0].total, limit: safeLimit, offset: safeOffset });
  } catch (err) {
    console.error('Get audit logs error:', err);
    return res.status(500).json({ message: 'Failed to fetch audit logs.' });
  }
};

export default { getAuditLogs };
