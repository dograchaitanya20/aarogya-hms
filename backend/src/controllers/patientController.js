import { z } from 'zod';
import patientService from '../services/patientService.js';

const createPatientSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD'),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().min(5, 'Valid phone number required'),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  allergies: z.string().optional(),
});

export async function listPatients(req, res, next) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);
    const q = req.query.q || '';

    const result = await patientService.listPatients({
      page,
      pageSize,
      q,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPatient(req, res, next) {
  try {
    const patient = await patientService.getPatient(req.params.id, {
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(200).json({ data: patient });
  } catch (err) {
    next(err);
  }
}

export async function createPatient(req, res, next) {
  try {
    const validated = createPatientSchema.parse(req.body);
    const patient = await patientService.createPatient(validated, {
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(201).json({ data: patient });
  } catch (err) {
    next(err);
  }
}

export async function updatePatient(req, res, next) {
  try {
    const updated = await patientService.updatePatient(req.params.id, req.body, {
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(200).json({
      message: 'Patient record updated successfully',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export default {
  listPatients,
  getPatient,
  createPatient,
  updatePatient,
};
