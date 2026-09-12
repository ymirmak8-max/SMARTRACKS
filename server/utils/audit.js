import pool from '../config/db.js';

export const writeAuditLog = async ({ actorId = null, action, entityType, entityId = null, details = {}, req = null }) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [actorId, action, entityType, entityId, JSON.stringify(details), req?.ip || null, req?.get?.('user-agent')?.slice(0, 500) || null]
    );
  } catch (error) { console.error('Audit log error:', error.message); }
};
