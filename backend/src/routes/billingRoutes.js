import { Router } from 'express';
import billingController from '../controllers/billingController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// Admin and Front Desk only. Clinician is 403 Forbidden!
router.get('/invoices', requireRole('admin', 'front_desk'), billingController.listInvoices);

export default router;
