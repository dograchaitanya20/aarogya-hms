import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import directoryRoutes from './directoryRoutes.js';
import patientRoutes from './patientRoutes.js';
import appointmentRoutes from './appointmentRoutes.js';
import slotRoutes, { doctorSlotRouter } from './slotRoutes.js';
import clinicalNoteRoutes from './clinicalNoteRoutes.js';
import clinicalRoutes from './clinicalRoutes.js';
import reportRoutes from './reportRoutes.js';
import billingRoutes from './billingRoutes.js';
import auditRoutes from './auditRoutes.js';

const router = Router();

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/directory', directoryRoutes);
router.use('/patients', patientRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/slots', slotRoutes);
router.use('/doctors', doctorSlotRouter);
router.use('/clinical-notes', clinicalNoteRoutes);
router.use('/clinical', clinicalRoutes);
router.use('/reports', reportRoutes);
router.use('/billing', billingRoutes);
router.use('/audit', auditRoutes);

export default router;
