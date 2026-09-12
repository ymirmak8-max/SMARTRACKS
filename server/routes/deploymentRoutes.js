import express from 'express';
import {
  getDeployments,
  createDeployment,
  updateDeployment,
  getCompanies,
  createCompany,
  updateCompany,
  createCompanyLocation,
  updateCompanyLocation,
  archiveCompanyLocation,
  getDeploymentOptions,
} from '../controllers/deploymentController.js';
import { verifyToken } from '../middleware/authMiddleware.js';
import { authorize } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.use(verifyToken, authorize('admin', 'coordinator'));

router.get('/companies', getCompanies);
router.get('/options', getDeploymentOptions);
router.post('/companies', createCompany);
router.put('/companies/:id', updateCompany);
router.post('/companies/:companyId/locations', createCompanyLocation);
router.put('/locations/:id', updateCompanyLocation);
router.delete('/locations/:id', archiveCompanyLocation);
router.get('/', getDeployments);
router.post('/', createDeployment);
router.put('/:id', updateDeployment);

export default router;
