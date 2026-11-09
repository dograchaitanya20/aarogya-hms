import { Router } from 'express';
import clinicalController from '../controllers/clinicalController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole, requireClinicianPatientAccess } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// Encounter list: clinician (own) and admin (METADATA only: no clinical content is ever returned here).
router.get('/encounters', requireRole('admin', 'clinician'), clinicalController.listEncounters);

// Clinical writes: clinician only, ownership of the encounter is enforced in the service.
router.post('/encounters/:encounterId/notes', requireRole('clinician'), clinicalController.addNote);
router.post('/encounters/:encounterId/prescriptions', requireRole('clinician'), clinicalController.addPrescription);
router.post(
  '/diagnostic-reports',
  requireRole('clinician'),
  clinicalController.addDiagnosticReport
);

// Full clinical record: clinician who treats this patient only. Admin and front_desk get 403.
router.get(
  '/patients/:patientId/records',
  requireRole('clinician'),
  requireClinicianPatientAccess('patientId'),
  clinicalController.getPatientRecords
);

export default router;
