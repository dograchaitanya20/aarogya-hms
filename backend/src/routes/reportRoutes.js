import { Router } from 'express';
import reportController from '../controllers/reportController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// Admin only. Aggregates only: no patient-identifying or clinical content.
router.get('/summary', requireRole('admin'), reportController.getSummary);

export default router;
