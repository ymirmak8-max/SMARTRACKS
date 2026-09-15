import express from 'express';
import {
  clockIn,
  clockOut,
  getTodayRecord,
  getDTRHistory,
  getDeploymentInfo,
  flagPerimeterExit,
  updateLiveLocation,
  getLiveLocations,
} from '../controllers/dtrController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { issueAttendanceChallenge } from '../utils/attendanceChallenge.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken);
router.post('/challenge', authorize('student'), async (req, res) => {
  try {
    const action = req.body.action === 'out' ? 'clock_out' : req.body.action === 'in' ? 'clock_in' : null;
    if (!action) return res.status(400).json({ message: 'Attendance action must be in or out.' });
    return res.status(201).json(await issueAttendanceChallenge(req.user.id, action));
  } catch {
    return res.status(500).json({ message: 'Attendance verification could not be started.' });
  }
});

router.post('/clock-in', authorize('student'), clockIn);
router.post('/clock-out', authorize('student'), clockOut);
router.get('/today', authorize('student'), getTodayRecord);
router.get('/history', authorize('student'), getDTRHistory);
router.get('/deployment-info', authorize('student'), getDeploymentInfo);
router.post('/flag-exit', authorize('student'), flagPerimeterExit);
router.post('/update-location', authorize('student'), updateLiveLocation);
router.get('/live-locations', authorize('coordinator', 'supervisor'), getLiveLocations);

export default router;
