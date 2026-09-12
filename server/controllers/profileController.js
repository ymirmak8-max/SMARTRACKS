import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import { writeAuditLog } from '../utils/audit.js';

export const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, phone, role, course, school, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'User not found.' });
    return res.status(200).json({ user: result.rows[0] });
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
       RETURNING id, first_name, last_name, email, phone, role, course, school`,
      [firstName, lastName, phone || null, course || null, school || null, req.user.id]
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

// PUT /api/profile/change-password
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
