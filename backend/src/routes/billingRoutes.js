import { Router } from 'express';
import billingController from '../controllers/billingController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { idempotency } from '../middleware/idempotency.js';

const router = Router();

router.use(requireAuth);

// Read: admin and front_desk. Clinicians are 403 (and the denial is audited).
router.get('/invoices', requireRole('admin', 'front_desk'), billingController.listInvoices);
router.get('/invoices/:id', requireRole('admin', 'front_desk'), billingController.getInvoice);

// Write: front_desk only. Creating invoices and taking payments require an Idempotency-Key.
router.post('/invoices', requireRole('front_desk'), idempotency({ required: true }), billingController.createInvoice);
router.post(
  '/invoices/:id/payments',
  requireRole('front_desk'),
  idempotency({ required: true }),
  billingController.createPayment
);
router.patch('/invoices/:id/cancel', requireRole('front_desk'), billingController.cancelInvoice);

export default router;
