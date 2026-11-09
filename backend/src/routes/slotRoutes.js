import { Router } from 'express';
import slotController from '../controllers/slotController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// Slots search: accessible to admin, clinician, and front_desk
router.get('/', requireRole('admin', 'clinician', 'front_desk'), slotController.searchSlots);
router.get('/doctors/:id/slots', requireRole('admin', 'clinician', 'front_desk'), slotController.getDoctorSlots);

// Spec path: GET /api/v1/doctors/:id/slots (the /slots/doctors/:id/slots form above is kept as an alias)
export const doctorSlotRouter = Router();
doctorSlotRouter.use(requireAuth);
doctorSlotRouter.get('/:id/slots', requireRole('admin', 'clinician', 'front_desk'), slotController.getDoctorSlots);

export default router;
