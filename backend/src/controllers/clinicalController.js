import { z } from 'zod';
import clinicalService from '../services/clinicalService.js';
import { parsePagination, reqMetaFrom } from '../utils/pagination.js';

const text = (max) => z.string().trim().max(max).optional();

const noteSchema = z.object({
  chiefComplaint: z.string().trim().min(1, 'Chief complaint is required').max(2000),
  symptoms: text(5000),
  clinicalExamination: text(5000),
  assessmentNotes: text(5000),
  plan: text(5000),
  diagnosisNotes: z.string().trim().min(1, 'Clinician diagnosis notes are required').max(5000),
});

const prescriptionSchema = z.object({
  instructions: text(2000),
  items: z
    .array(
      z.object({
        medicineName: z.string().trim().min(1).max(255),
        dosage: z.string().trim().min(1).max(100),
        frequency: z.string().trim().min(1).max(100),
        durationDays: z.number().int().min(1).max(365),
        instructions: text(1000),
      })
    )
    .min(1, 'At least one prescription item is required')
    .max(20),
});

const reportSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().optional(),
  testName: z.string().trim().min(1).max(255),
  category: z.enum(['radiology', 'pathology', 'cardiology', 'other']),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  fileName: z.string().trim().min(1).max(255),
  status: z.enum(['pending', 'completed', 'cancelled']).default('completed'),
  notes: text(2000),
});

export async function addNote(req, res, next) {
  try {
    const data = noteSchema.parse(req.body);
    const note = await clinicalService.addNote({
      encounterId: req.params.encounterId,
      data,
      user: req.user,
      reqMeta: reqMetaFrom(req),
    });
    res.status(201).json({ message: 'Clinical note saved', data: note });
  } catch (err) {
    next(err);
  }
}

export async function addPrescription(req, res, next) {
  try {
    const data = prescriptionSchema.parse(req.body);
    const prescription = await clinicalService.addPrescription({
      encounterId: req.params.encounterId,
      data,
      user: req.user,
      reqMeta: reqMetaFrom(req),
    });
    res.status(201).json({ message: 'Prescription saved', data: prescription });
  } catch (err) {
    next(err);
  }
}

export async function addDiagnosticReport(req, res, next) {
  try {
    const data = reportSchema.parse(req.body);
    const report = await clinicalService.addDiagnosticReport({ data, user: req.user, reqMeta: reqMetaFrom(req) });
    res.status(201).json({ message: 'Diagnostic report metadata saved', data: report });
  } catch (err) {
    next(err);
  }
}

export async function getPatientRecords(req, res, next) {
  try {
    const records = await clinicalService.getPatientRecords({
      patientId: req.params.patientId,
      user: req.user,
      reqMeta: reqMetaFrom(req),
    });
    res.status(200).json({ data: records });
  } catch (err) {
    next(err);
  }
}

export async function listEncounters(req, res, next) {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const result = await clinicalService.listEncounters({
      page,
      pageSize,
      patientId: req.query.patientId || null,
      status: req.query.status || null,
      user: req.user,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default { addNote, addPrescription, addDiagnosticReport, getPatientRecords, listEncounters };
