import patientRepository from '../repositories/patientRepository.js';
import auditService from './auditService.js';
import { NotFoundError } from '../errors/AppError.js';

export async function listPatients({ page = 1, pageSize = 20, q = '', user, reqMeta }) {
  const result = await patientRepository.getPatients({ page, pageSize, q });

  // Audit read of patient list
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'READ_PATIENT_LIST',
    entityType: 'patient',
    entityId: 'list',
    afterState: { count: result.data.length, page, q },
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return result;
}

export async function getPatient(patientId, { user, reqMeta }) {
  const patient = await patientRepository.getPatientById(patientId);
  if (!patient) {
    throw new NotFoundError(`Patient with ID '${patientId}' not found`);
  }

  // Audit read of single patient record
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'READ_PATIENT_RECORD',
    entityType: 'patient',
    entityId: patient.id,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return patient;
}

export async function createPatient(data, { user, reqMeta }) {
  const mrn = data.mrn || `MRN-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const patient = await patientRepository.createPatient({ ...data, mrn });

  // Audit creation of patient
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'CREATE_PATIENT',
    entityType: 'patient',
    entityId: patient.id,
    afterState: patient,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return patient;
}

export default {
  listPatients,
  getPatient,
  createPatient,
};
