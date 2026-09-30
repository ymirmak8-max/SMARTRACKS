import bcrypt from 'bcrypt';
import pool from '../config/db.js';
import { sendAccountStatusEmail } from '../utils/sendEmail.js';
import { writeAuditLog } from '../utils/audit.js';
import crypto from 'node:crypto';
import { sanitizePhone } from '../utils/phone.js';
import { createTemporaryPassword, revokeUserSessions } from '../utils/authSession.js';

const persistAssignedCompany = async (userId, companyId) => {
  if (!companyId) return;
  try {
    await pool.query('UPDATE users SET company_id = $1, updated_at = NOW() WHERE id = $2', [companyId, userId]);
  } catch (error) {
    console.error('Assigned company was not saved. Run server/sql/migration_20260912_user_company.sql.', error.message);
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const { role, search, approval_status } = req.query;
    let query = `
      SELECT id, first_name, last_name, email, role, is_active, approval_status, phone, course, school, created_at,
        (
          SELECT c.name FROM deployments d
          JOIN companies c ON c.id = d.company_id
          WHERE d.status = 'active'
            AND (d.student_id = users.id OR d.supervisor_id = users.id OR d.coordinator_id = users.id)
          ORDER BY d.start_date DESC NULLS LAST
          LIMIT 1
        ) AS company_name,
        (
          SELECT d.company_id FROM deployments d
          WHERE d.status = 'active'
            AND (d.student_id = users.id OR d.supervisor_id = users.id OR d.coordinator_id = users.id)
          ORDER BY d.start_date DESC NULLS LAST
          LIMIT 1
        ) AS company_id
      FROM users WHERE 1=1
    `;
    const params = [];

    if (role === 'coordinator') {
      query += ` AND role IN ('coordinator', 'admin')`;
    } else if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }
    if (approval_status) {
      params.push(approval_status);
      query += ` AND approval_status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    query += ` ORDER BY created_at DESC`;
    const result = await pool.query(query, params);
    const users = result.rows.map(user => ({
      ...user,
      role: user.role === 'admin' ? 'coordinator' : user.role,
    }));
    try {
      const ids = users.map(user => user.id);
      if (ids.length) {
        const homes = await pool.query(
          `SELECT u.id, u.company_id, c.name AS company_name, c.address AS company_address
           FROM users u
           LEFT JOIN companies c ON c.id = u.company_id
           WHERE u.id = ANY($1::uuid[]) AND u.company_id IS NOT NULL`,
          [ids]
        );
        const byId = Object.fromEntries(homes.rows.map(row => [row.id, row]));
        users.forEach(user => {
          const home = byId[user.id];
          if (!home) return;
          if (!user.company_name) user.company_name = home.company_name;
          if (!user.company_id) user.company_id = home.company_id;
          if (!user.company_address) user.company_address = home.company_address;
        });
      }
    } catch {
      // users.company_id is added by migration_20260912_user_company.sql
    }
    return res.status(200).json({ users });
  } catch (err) {
    console.error('Get users error:', err);
    return res.status(500).json({ message: 'Failed to fetch users.' });
  }
};

export const createUser = async (req, res) => {
  try {
    const { firstName, lastName, email, password, role, phone, course, school, companyId } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();
    const validRoles = ['student', 'coordinator', 'supervisor'];
    if (!firstName || !lastName || !normalizedEmail || !password || !role)
      return res.status(400).json({ message: 'All fields are required.' });
    if (!validRoles.includes(role))
      return res.status(400).json({ message: 'Invalid role.' });
    if (password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
// Validate email
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
if (!emailRegex.test(normalizedEmail))
  return res.status(400).json({ message: 'Please enter a valid email address.' });

const blockedDomains = [
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'trashmail.com', 'trashmail.me',
  'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'temp-mail.org',
  'getnada.com', 'mohmal.com', 'tempr.email', 'mailnesia.com',
];
const emailDomain = normalizedEmail.split('@')[1];
if (blockedDomains.includes(emailDomain))
  return res.status(400).json({ message: 'Please use a valid email address.' });
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
    if (existing.rows.length > 0)
      return res.status(409).json({ message: 'Email already in use.' });

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, phone, course, school, must_change_password, approval_status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'approved', true)
       RETURNING id, first_name, last_name, email, role, approval_status, is_active`,
      [firstName.trim(), lastName.trim(), normalizedEmail, passwordHash, role, sanitizePhone(phone),
       course || null, school || null]
    );

    await persistAssignedCompany(result.rows[0].id, companyId);
    await writeAuditLog({ actorId: req.user.id, action: 'user.create', entityType: 'user', entityId: result.rows[0].id, details: { role }, req });
    if (role === 'student') {
      const { notifyStudentReady } = await import('../utils/staffNotify.js');
      notifyStudentReady({
        firstName: result.rows[0].first_name,
        lastName: result.rows[0].last_name,
        source: 'create',
      }).catch(error => console.error('Student create notify error:', error.message));
    }

    return res.status(201).json({ message: 'User created.', user: result.rows[0] });
  } catch (err) {
    console.error('Create user error:', err);
    return res.status(500).json({ message: 'Failed to create user.' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, role, phone, course, school, password, companyId } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();
    const validRoles = ['student', 'coordinator', 'supervisor'];

    if (!firstName?.trim() || !lastName?.trim() || !normalizedEmail || !role)
      return res.status(400).json({ message: 'First name, last name, email, and role are required.' });
    if (!validRoles.includes(role))
      return res.status(400).json({ message: 'Invalid role.' });
    if (id === req.user.id && role !== req.user.role)
      return res.status(400).json({ message: 'You cannot change your own role.' });
    if (password && password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(normalizedEmail))
      return res.status(400).json({ message: 'Please enter a valid email address.' });

    const conflict = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2', [normalizedEmail, id]
    );
    if (conflict.rows.length > 0)
      return res.status(409).json({ message: 'Email already in use.' });

    let query, params;
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      query = `UPDATE users SET first_name=$1, last_name=$2, email=$3, role=$4, phone=$5, course=$6, school=$7,
               password_hash=$8, must_change_password=true, updated_at=NOW()
               WHERE id=$9 RETURNING id, first_name, last_name, email, role, phone, course, school, is_active`;
      params = [firstName.trim(), lastName.trim(), normalizedEmail, role, sanitizePhone(phone),
        course?.trim() || null, school?.trim() || null, passwordHash, id];
    } else {
      query = `UPDATE users SET first_name=$1, last_name=$2, email=$3, role=$4, phone=$5, course=$6, school=$7,
               updated_at=NOW()
               WHERE id=$8 RETURNING id, first_name, last_name, email, role, phone, course, school, is_active`;
      params = [firstName.trim(), lastName.trim(), normalizedEmail, role, sanitizePhone(phone),
        course?.trim() || null, school?.trim() || null, id];
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });

    await persistAssignedCompany(id, companyId);
    if (password && id !== req.user.id) await revokeUserSessions(id);
    await writeAuditLog({ actorId: req.user.id, action: 'user.update', entityType: 'user', entityId: id, details: { role }, req });

    return res.status(200).json({ user: result.rows[0], message: 'User updated successfully.' });
  } catch (err) {
    console.error('Update user error:', err);
    return res.status(500).json({ message: 'Failed to update user.' });
  }
};

export const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id)
      return res.status(400).json({ message: 'Use Account settings to change your own password.' });

    const existing = await pool.query(
      'SELECT id, email, first_name, last_name, is_active FROM users WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });

    const temporaryPassword = createTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await pool.query(
      `UPDATE users
       SET password_hash = $1, must_change_password = true, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, id]
    );
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [id]);
    await revokeUserSessions(id);
    await writeAuditLog({
      actorId: req.user.id, action: 'user.password_reset', entityType: 'user', entityId: id, req,
    });

    return res.status(200).json({
      message: `Password reset for ${existing.rows[0].first_name} ${existing.rows[0].last_name}. Share the temporary password securely.`,
      email: existing.rows[0].email,
      temporaryPassword,
    });
  } catch (err) {
    console.error('Admin password reset error:', err);
    return res.status(500).json({ message: 'Failed to reset password.' });
  }
};

export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id)
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    const result = await pool.query(
      `UPDATE users
       SET is_active = CASE WHEN approval_status = 'pending' THEN true ELSE NOT is_active END,
           approval_status = 'approved', updated_at = NOW()
       WHERE id = $1 RETURNING id, email, is_active, approval_status`,
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });

    const changedUser = result.rows[0];
    await writeAuditLog({ actorId: req.user.id, action: changedUser.is_active ? 'user.approve_or_activate' : 'user.deactivate', entityType: 'user', entityId: id, req });
    sendAccountStatusEmail({ to: changedUser.email, status: changedUser.is_active ? 'approved' : 'deactivated' }).catch(error => console.error('Account status email error:', error.message));
    if (changedUser.is_active) {
      const profile = await pool.query('SELECT first_name, last_name, role FROM users WHERE id = $1', [id]);
      if (profile.rows[0]?.role === 'student') {
        const { notifyStudentReady } = await import('../utils/staffNotify.js');
        notifyStudentReady({
          firstName: profile.rows[0].first_name,
          lastName: profile.rows[0].last_name,
          source: 'create',
        }).catch(error => console.error('Student approve notify error:', error.message));
      }
    }

    return res.status(200).json({
      message: result.rows[0].is_active ? 'User approved and activated successfully.' : 'User deactivated successfully.',
      isActive: result.rows[0].is_active,
      approvalStatus: result.rows[0].approval_status,
    });
  } catch (err) {
    console.error('Toggle status error:', err);
    return res.status(500).json({ message: 'Failed to update status.' });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id)
      return res.status(400).json({ message: 'You cannot delete your own account.' });

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, email, approval_status', [id]);
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });

    await writeAuditLog({ actorId: req.user.id, action: 'user.delete', entityType: 'user', entityId: id, req });
    if (result.rows[0].approval_status === 'pending')
      sendAccountStatusEmail({ to: result.rows[0].email, status: 'rejected' }).catch(error => console.error('Registration rejection email error:', error.message));

    return res.status(200).json({ message: 'User deleted successfully.' });
  } catch (err) {
    console.error('Delete user error:', err);
    return res.status(500).json({ message: 'Failed to delete user.' });
  }
};

export const bulkUserAction = async (req, res) => {
  try {
    const { action, ids } = req.body; // action: 'approve' | 'activate' | 'deactivate' | 'delete' | 'reject'
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'No user ids provided.' });
    const allowed = ['approve', 'activate', 'deactivate', 'delete', 'reject'];
    if (!allowed.includes(action)) return res.status(400).json({ message: 'Invalid action.' });
    if (['deactivate', 'delete', 'reject'].includes(action) && ids.includes(req.user.id))
      return res.status(400).json({ message: 'You cannot deactivate, delete, or reject your own account.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (action === 'delete') {
        const delRes = await client.query('DELETE FROM users WHERE id = ANY($1::uuid[]) RETURNING id, email, approval_status', [ids]);
        for (const row of delRes.rows) {
          await writeAuditLog({ actorId: req.user.id, action: 'user.delete', entityType: 'user', entityId: row.id, req });
          if (row.approval_status === 'pending')
            sendAccountStatusEmail({ to: row.email, status: 'rejected' }).catch(() => {});
        }
        await client.query('COMMIT');
        return res.status(200).json({ message: `${delRes.rows.length} users deleted.` });
      }

      if (action === 'reject') {
        const upd = await client.query(
          `UPDATE users SET approval_status = 'rejected', is_active = false, updated_at = NOW() WHERE id = ANY($1::uuid[]) RETURNING id, email, approval_status`,
          [ids]
        );
        for (const row of upd.rows) {
          await writeAuditLog({ actorId: req.user.id, action: 'user.reject', entityType: 'user', entityId: row.id, req });
          sendAccountStatusEmail({ to: row.email, status: 'rejected' }).catch(() => {});
        }
        await client.query('COMMIT');
        return res.status(200).json({ message: `${upd.rows.length} users rejected.` });
      }

      // For approve/activate/deactivate, update records
      if (action === 'approve' || action === 'activate') {
        const upd = await client.query(
          `UPDATE users SET is_active = true, approval_status = 'approved', updated_at = NOW()
           WHERE id = ANY($1::uuid[]) RETURNING id, email, is_active`,
          [ids]
        );
        for (const row of upd.rows) {
          await writeAuditLog({ actorId: req.user.id, action: 'user.approve_or_activate', entityType: 'user', entityId: row.id, req });
          sendAccountStatusEmail({ to: row.email, status: 'approved' }).catch(() => {});
        }
        await client.query('COMMIT');
        return res.status(200).json({ message: `${upd.rows.length} users approved/activated.` });
      }

      if (action === 'deactivate') {
        const upd = await client.query(
          `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ANY($1::uuid[]) RETURNING id, email, is_active`,
          [ids]
        );
        for (const row of upd.rows) {
          await writeAuditLog({ actorId: req.user.id, action: 'user.deactivate', entityType: 'user', entityId: row.id, req });
          sendAccountStatusEmail({ to: row.email, status: 'deactivated' }).catch(() => {});
        }
        await client.query('COMMIT');
        return res.status(200).json({ message: `${upd.rows.length} users deactivated.` });
      }
    } catch (innerErr) {
      await client.query('ROLLBACK');
      console.error('Bulk user action error:', innerErr);
      return res.status(500).json({ message: 'Failed to perform bulk action.' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Bulk user action outer error:', err);
    return res.status(500).json({ message: 'Failed to perform bulk action.' });
  }
};

export const importStudents = async (req, res) => {
  const rows = req.body.rows;
  const dryRun = req.body.dryRun !== false;
  if (!Array.isArray(rows) || !rows.length || rows.length > 200)
    return res.status(400).json({ message: 'Provide between 1 and 200 student rows.' });

  const normalized = rows.map((row, index) => ({
    row: index + 2,
    firstName: String(row.firstName || row.first_name || '').trim(),
    lastName: String(row.lastName || row.last_name || '').trim(),
    email: String(row.email || '').trim().toLowerCase(),
    phone: sanitizePhone(row.phone),
    course: String(row.course || '').trim() || null,
    school: String(row.school || '').trim() || null,
  }));
  const errors = [];
  const seen = new Set();
  for (const row of normalized) {
    if (!row.firstName || !row.lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
      errors.push({ row: row.row, message: 'First name, last name, and a valid email are required.' });
    if (row.email) {
      if (seen.has(row.email)) errors.push({ row: row.row, message: 'Duplicate email in import.' });
      seen.add(row.email);
    }
  }
  const emails = normalized.map(row => row.email).filter(Boolean);
  const existing = await pool.query('SELECT LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1::text[])',
    [emails]);
  const existingSet = new Set(existing.rows.map(row => row.email));
  normalized.filter(row => existingSet.has(row.email))
    .forEach(row => errors.push({ row: row.row, message: 'Email already exists.' }));
  if (dryRun || errors.length) return res.status(errors.length ? 422 : 200).json({
    valid: errors.length === 0, total: normalized.length, errors,
  });

  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');
    for (const row of normalized) {
      const temporaryPassword = `Tp!${crypto.randomBytes(9).toString('base64url')}`;
      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      const result = await client.query(`
        INSERT INTO users
          (first_name, last_name, email, password_hash, role, phone, course, school,
           must_change_password, approval_status, is_active)
        VALUES ($1,$2,$3,$4,'student',$5,$6,$7,true,'approved',true)
        RETURNING id, first_name, last_name, email
      `, [row.firstName, row.lastName, row.email, passwordHash, row.phone, row.course, row.school]);
      created.push({ ...result.rows[0], temporaryPassword });
    }
    await client.query('COMMIT');
    await writeAuditLog({ actorId: req.user.id, action: 'user.student_import', entityType: 'user',
      details: { count: created.length }, req });
    return res.status(201).json({ message: `${created.length} students imported.`, students: created });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'Student import failed; no students were created.' });
  } finally {
    client.release();
  }
};
