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

// Get single patient: admin, front_desk, or clinician (with patient relationship check)
router.get('/:id', requireRole('admin', 'front_desk', 'clinician'), requireClinicianPatientAccess('id'), patientController.getPatient);

export default router;
