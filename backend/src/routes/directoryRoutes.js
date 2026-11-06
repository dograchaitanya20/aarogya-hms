import { Router } from 'express';
import directoryController from '../controllers/directoryController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// 1. Departments
router.get('/departments', requireRole('admin', 'clinician', 'front_desk'), directoryController.listDepartments);
router.post('/departments', requireRole('admin'), directoryController.createDepartment);

// 2. Doctors
router.get('/doctors', requireRole('admin', 'clinician', 'front_desk'), directoryController.listDoctors);
router.post('/doctors', requireRole('admin'), directoryController.createDoctor);

// 3. Doctor Schedules
router.get('/doctors/:doctorId/schedules', requireRole('admin', 'clinician', 'front_desk'), directoryController.getDoctorSchedules);
router.post('/schedules', requireRole('admin'), directoryController.createSchedule);

// 4. Staff Management (Admin only)
router.get('/staff', requireRole('admin'), directoryController.listStaff);
router.post('/staff', requireRole('admin'), directoryController.createStaff);
router.patch('/staff/:id/status', requireRole('admin'), directoryController.setStaffStatus);

export default router;
