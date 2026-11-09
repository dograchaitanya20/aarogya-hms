import { z } from 'zod';
import patientService from '../services/patientService.js';
import { parsePagination } from '../utils/pagination.js';

const createPatientSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(200),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD'),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().trim().min(5, 'Valid phone number required').max(30),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  allergies: z.string().optional(),
});

// Same field rules as create, all optional. .strict() rejects unknown keys (e.g. mrn, isActive) with 422.
const updatePatientSchema = z
  .object({
    fullName: z.string().trim().min(2).max(200),
    phone: z.string().trim().min(5).max(30),
    email: z.string().trim().email().max(255).or(z.literal('')),
    address: z.string().max(500),
    emergencyContactName: z.string().max(200),
    emergencyContactPhone: z.string().max(30),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
    allergies: z.string().max(1000),
  })
  .partial()
  .strict();

export async function listPatients(req, res, next) {
  try {
    const { page, pageSize } = parsePagination(req.query, 20);
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
    const updated = await patientService.updatePatient(req.params.id, updatePatientSchema.parse(req.body), {
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
