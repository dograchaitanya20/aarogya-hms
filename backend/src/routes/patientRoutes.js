import { Router } from 'express';
import patientController from '../controllers/patientController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole, requireClinicianPatientAccess } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// List patients: admin, front_desk, clinician
router.get('/', requireRole('admin', 'front_desk', 'clinician'), patientController.listPatients);

// Create patient: strictly front_desk only (least privilege)
router.post('/', requireRole('front_desk'), patientController.createPatient);

// Update patient: strictly front_desk only
router.put('/:id', requireRole('front_desk'), patientController.updatePatient);

// Get single patient: front_desk, admin, or clinician (with clinician-patient access verification)
router.get(
  '/:id',
  requireRole('admin', 'front_desk', 'clinician'),
  requireClinicianPatientAccess('id'),
  patientController.getPatient
);

export default router;
