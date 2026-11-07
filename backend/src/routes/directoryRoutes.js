import { Router } from 'express';
import directoryController from '../controllers/directoryController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

router.use(requireAuth);

// 1. Departments
router.get('/departments', requireRole('admin', 'clinician', 'front_desk'), directoryController.listDepartments);
router.post('/departments', requireRole('admin'), directoryController.createDepartment);
router.patch('/departments/:id', requireRole('admin'), directoryController.updateDepartment);
router.delete('/departments/:id', requireRole('admin'), directoryController.deleteDepartment);

// 2. Doctors
router.get('/doctors', requireRole('admin', 'clinician', 'front_desk'), directoryController.listDoctors);
router.get('/doctors/:id', requireRole('admin', 'clinician', 'front_desk'), directoryController.getDoctorById);
router.post('/doctors', requireRole('admin'), directoryController.createDoctor);
router.patch('/doctors/:id', requireRole('admin'), directoryController.updateDoctor);
router.delete('/doctors/:id', requireRole('admin'), directoryController.deleteDoctor);

// 3. Doctor Schedules
router.get('/doctors/:doctorId/schedules', requireRole('admin', 'clinician', 'front_desk'), directoryController.getDoctorSchedules);
router.post('/schedules', requireRole('admin'), directoryController.createSchedule);
router.patch('/schedules/:id', requireRole('admin'), directoryController.updateSchedule);
router.delete('/schedules/:id', requireRole('admin'), directoryController.deleteSchedule);

// 4. Staff Management (Admin only)
router.get('/staff', requireRole('admin'), directoryController.listStaff);
router.post('/staff', requireRole('admin'), directoryController.createStaff);
router.patch('/staff/:id/status', requireRole('admin'), directoryController.setStaffStatus);

export default router;
