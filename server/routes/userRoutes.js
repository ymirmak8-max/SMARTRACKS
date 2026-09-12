import express from 'express';
import {
  getAllUsers,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser,
  bulkUserAction,
  importStudents,
} from '../controllers/userController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken, authorize('admin'));

router.get('/', getAllUsers);
router.post('/', createUser);
router.post('/bulk', bulkUserAction);
router.post('/import-students', importStudents);
router.put('/:id', updateUser);
router.patch('/:id/status', toggleUserStatus);
router.delete('/:id', deleteUser);

export default router;
