import pool from '../config/db.js';
import { sendNotification } from '../controllers/notificationController.js';

export const notifyRoles = async (roles, title, body, type = 'general') => {
  const result = await pool.query(
    `SELECT id FROM users
     WHERE role = ANY($1::text[])
       AND is_active = true
       AND approval_status = 'approved'`,
    [roles]
  );
  await Promise.all(result.rows.map(user =>
    sendNotification(user.id, title, body, type).catch(error =>
      console.error('Staff notification failed:', error.message)
    )
  ));
};

export const notifyStudentReady = async ({ firstName, lastName, source }) => {
  const name = `${firstName} ${lastName}`.trim();
  const body = source === 'register'
    ? `${name} registered and is waiting for approval, then assignment to a company.`
    : `${name} is approved and ready to deploy to a company and supervisor.`;
  await notifyRoles(
    ['coordinator', 'admin'],
    source === 'register' ? 'New student registration' : 'Student ready to deploy',
    body,
    'general'
  );
};
