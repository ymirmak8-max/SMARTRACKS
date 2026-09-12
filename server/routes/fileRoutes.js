import express from 'express';
import { authorizeStoredFile, deleteStoredFile, getAttendanceFileMetadata, streamStoredFile } from '../utils/storage.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { findRefreshToken, findUserById } from '../models/userModel.js';
import { writeAuditLog } from '../utils/audit.js';

const router = express.Router();

const verifyFileAccess = async (req, res, next) => {
  if (req.headers.authorization) return verifyToken(req, res, next);
  try {
    const refresh = req.cookies?.refreshToken && await findRefreshToken(req.cookies.refreshToken);
    const user = refresh && await findUserById(refresh.user_id);
    if (!user) return res.status(401).json({ message: 'Authentication required.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: 'Authentication required.' });
  }
};

router.get('/:token', verifyFileAccess, async (req, res) => {
  try {
    const allowed = await authorizeStoredFile(req.params.token, req.user);
    if (!allowed) return res.status(404).json({ message: 'File not found.' });
    await streamStoredFile(req.params.token, res);
  }
  catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : 'Unable to retrieve file.' }); }
});

router.post('/:token/access-log', verifyFileAccess, async (req, res) => {
  try {
    const allowed = await authorizeStoredFile(req.params.token, req.user);
    if (!allowed) return res.status(404).json({ message: 'File not found.' });
    const metadata = await getAttendanceFileMetadata(req.params.token);
    if (!metadata || !['clock_in', 'clock_out'].includes(metadata.image_type))
      return res.status(400).json({ message: 'This file is not an attendance selfie.' });
    await writeAuditLog({
      actorId: req.user.id,
      action: 'attendance.selfie_view',
      entityType: 'time_record',
      entityId: metadata.time_record_id,
      details: { studentId: metadata.student_id, imageType: metadata.image_type },
      req,
    });
    return res.status(204).send();
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Unable to record image access.' });
  }
});

router.delete('/:token/attendance-selfie', verifyFileAccess, async (req, res) => {
  try {
    if (!['admin', 'coordinator'].includes(req.user.role))
      return res.status(403).json({ message: 'Only an assigned coordinator or admin can delete attendance images.' });
    const allowed = await authorizeStoredFile(req.params.token, req.user);
    if (!allowed) return res.status(404).json({ message: 'File not found.' });
    const metadata = await getAttendanceFileMetadata(req.params.token);
    if (!metadata || !['clock_in', 'clock_out'].includes(metadata.image_type))
      return res.status(400).json({ message: 'This file is not an attendance selfie.' });

    const fileUrl = `/api/files/${req.params.token}`;
    await deleteStoredFile(fileUrl);
    const column = metadata.image_type === 'clock_in' ? 'selfie_in_url' : 'selfie_out_url';
    const result = await (await import('../config/db.js')).default.query(
      `UPDATE time_records SET ${column} = NULL WHERE id = $1 RETURNING id`,
      [metadata.time_record_id]
    );
    if (!result.rows.length) return res.status(409).json({ message: 'The image reference has already changed.' });

    await writeAuditLog({
      actorId: req.user.id,
      action: 'attendance.selfie_delete',
      entityType: 'time_record',
      entityId: metadata.time_record_id,
      details: { studentId: metadata.student_id, imageType: metadata.image_type },
      req,
    });
    return res.status(200).json({ message: 'Attendance image deleted.', timeRecordId: metadata.time_record_id, imageType: metadata.image_type });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Unable to delete attendance image.' });
  }
});

export default router;
