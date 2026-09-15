import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import { writeAuditLog } from '../utils/audit.js';
import { sanitizePhone } from '../utils/phone.js';
import { deleteStoredFile, PROFILE_IMAGE_TYPES, persistUpload } from '../utils/storage.js';

const loadAssignedCompanies = async (userId, role) => {
  const column = role === 'student' ? 'd.student_id' : role === 'supervisor' ? 'd.supervisor_id' : 'd.coordinator_id';
  if (!['student', 'supervisor', 'coordinator'].includes(role)) return [];
  const result = await pool.query(
    `SELECT DISTINCT c.id, c.name, c.address
     FROM deployments d
     JOIN companies c ON c.id = d.company_id
     WHERE ${column} = $1 AND d.status = 'active'
     ORDER BY c.name`,
    [userId]
  );
  if (result.rows.length) return result.rows;
  try {
    const home = await pool.query(
      `SELECT c.id, c.name, c.address
       FROM users u
       JOIN companies c ON c.id = u.company_id
       WHERE u.id = $1`,
      [userId]
    );
    return home.rows;
  } catch {
    return [];
  }
};

export const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role, course, school, profile_picture, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });
    const user = result.rows[0];
    const companies = await loadAssignedCompanies(user.id, user.role);
    return res.status(200).json({
      user: {
        ...user,
        companies,
        company_name: companies[0]?.name || null,
        company_address: companies[0]?.address || null,
      },
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ message: 'Failed to fetch profile.' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, course, school } = req.body;

    if (!firstName || !lastName)
      return res.status(400).json({ message: 'First and last name are required.' });

    const result = await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, phone = $3,
       course = $4, school = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, first_name, last_name, email, phone, role, course, school, profile_picture`,
      [firstName.trim(), lastName.trim(), sanitizePhone(phone), course || null, school || null, req.user.id]
    );

    await writeAuditLog({ actorId: req.user.id, action: 'profile.update', entityType: 'user',
      entityId: req.user.id, req });

    return res.status(200).json({
      message: 'Profile updated successfully.',
      user: result.rows[0],
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ message: 'Failed to update profile.' });
  }
};

export const uploadProfilePicture = async (req, res) => {
  try {
    const image = req.body?.image || req.body?.profilePicture;
    if (!image)
      return res.status(400).json({ message: 'A profile photo is required.' });

    const profilePicture = await persistUpload(image, {
      folder: 'profiles',
      ownerId: req.user.id,
      allowedTypes: PROFILE_IMAGE_TYPES,
      maxBytes: 2 * 1024 * 1024,
    });

    const previous = await pool.query('SELECT profile_picture FROM users WHERE id = $1', [req.user.id]);
    await pool.query(
      'UPDATE users SET profile_picture = $1, updated_at = NOW() WHERE id = $2',
      [profilePicture, req.user.id]
    );
    const previousUrl = previous.rows[0]?.profile_picture;
    if (previousUrl && previousUrl !== profilePicture)
      await deleteStoredFile(previousUrl).catch(() => {});

    await writeAuditLog({ actorId: req.user.id, action: 'profile.picture_update', entityType: 'user',
      entityId: req.user.id, req });

    return res.status(200).json({
      message: 'Profile photo updated.',
      profilePicture,
      profile_picture: profilePicture,
    });
  } catch (err) {
    console.error('Profile picture upload error:', err);
    return res.status(err.status || 500).json({ message: err.status ? err.message : 'Failed to update profile photo.' });
  }
};

export const removeProfilePicture = async (req, res) => {
  try {
    const previous = await pool.query('SELECT profile_picture FROM users WHERE id = $1', [req.user.id]);
    await pool.query('UPDATE users SET profile_picture = NULL, updated_at = NOW() WHERE id = $1', [req.user.id]);
    if (previous.rows[0]?.profile_picture)
      await deleteStoredFile(previous.rows[0].profile_picture).catch(() => {});
    await writeAuditLog({ actorId: req.user.id, action: 'profile.picture_remove', entityType: 'user',
      entityId: req.user.id, req });
    return res.status(200).json({ message: 'Profile photo removed.', profilePicture: null, profile_picture: null });
  } catch (err) {
    console.error('Profile picture remove error:', err);
    return res.status(500).json({ message: 'Failed to remove profile photo.' });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Both passwords are required.' });

    if (newPassword.length < 8)
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });

    const result = await pool.query(
      `SELECT password_hash FROM users WHERE id = $1`, [req.user.id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });

    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isMatch)
      return res.status(400).json({ message: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2`,
      [newHash, req.user.id]
    );

    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

    await writeAuditLog({ actorId: req.user.id, action: 'password.change', entityType: 'user',
      entityId: req.user.id, req });

    return res.status(200).json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'Failed to change password.' });
  }
};

export const markPasswordChanged = async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET must_change_password = false WHERE id = $1',
      [req.user.id]
    );
    return res.status(200).json({ message: 'Password change marked.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update.' });
  }
};
