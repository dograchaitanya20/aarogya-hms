import { Router } from 'express';
import directoryController from '../controllers/directoryController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

// Read directory: allowed for admin, clinician, front_desk
router.get('/departments', requireAuth, requireRole('admin', 'clinician', 'front_desk'), directoryController.listDepartments);

// Write directory: admin only
router.post('/departments', requireAuth, requireRole('admin'), directoryController.createDepartment);

export default router;
