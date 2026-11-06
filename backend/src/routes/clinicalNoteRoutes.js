import { Router } from 'express';
import clinicalNoteController from '../controllers/clinicalNoteController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole, requireClinicianPatientAccess } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// Clinician only, and only if treating the patient! Admin and Front Desk are strictly 403 Forbidden.
router.get(
  '/patients/:patientId',
  requireRole('clinician'),
  requireClinicianPatientAccess('patientId'),
  clinicalNoteController.getPatientNotes
);

export default router;
