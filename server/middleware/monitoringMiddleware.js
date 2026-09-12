import pool from '../config/db.js';
import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

export const monitorRequests = (req, res, next) => {
  const started = Date.now();
  req.requestId = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  res.once('finish', () => {
    const durationMs = Date.now() - started;
    if (res.statusCode < 500 && durationMs < 1500) return;
    const severity = res.statusCode >= 500 ? 'error' : 'warning';
    const category = res.statusCode >= 500 ? 'api_error' : 'slow_request';
    pool.query(`
      INSERT INTO system_events
        (severity, category, message, method, path, status_code, duration_ms, actor_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [severity, category,
      res.statusCode >= 500 ? `API request returned ${res.statusCode}` : `API request exceeded 1500 ms`,
      req.method, req.originalUrl.split('?')[0].slice(0, 500), res.statusCode, durationMs, req.user?.id || null]
    ).catch(error => logger.error('Operational event persistence failed', {
      error,
      requestId: req.requestId,
    }));
  });
  next();
};
