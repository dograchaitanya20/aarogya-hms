import { Router } from 'express';
import auditController from '../controllers/auditController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// Admin only: audit log viewer. Clinician and Front Desk are 403 Forbidden!
router.get('/logs', requireRole('admin'), auditController.listAuditLogs);

export default router;
