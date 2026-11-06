import { Router } from 'express';
import appointmentController from '../controllers/appointmentController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { idempotency } from '../middleware/idempotency.js';

const router = Router();

router.use(requireAuth);

// Booking requires Idempotency-Key header and front_desk role
router.post(
  '/',
  requireRole('front_desk'),
  idempotency({ required: true }),
  appointmentController.book
);

// Listing & details
router.get('/', requireRole('admin', 'clinician', 'front_desk'), appointmentController.list);
router.get('/:id', requireRole('admin', 'clinician', 'front_desk'), appointmentController.getById);

// Reschedule: front_desk only
router.patch('/:id/reschedule', requireRole('front_desk'), appointmentController.reschedule);

// Status change: front_desk or clinician (permissions checked inside service)
router.patch('/:id/status', requireRole('front_desk', 'clinician'), appointmentController.updateStatus);

export default router;
