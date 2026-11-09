import patientRepository from '../repositories/patientRepository.js';
import auditService from './auditService.js';
import { NotFoundError, ValidationError } from '../errors/AppError.js';
import { withTransaction } from '../utils/transaction.js';

export async function listPatients({ page = 1, pageSize = 20, q = '', user, reqMeta }) {
  const clinicianDoctorId = user.role === 'clinician' ? user.doctor_id : null;
  const result = await patientRepository.getPatients({ page, pageSize, q, clinicianDoctorId });

  // Audit read of patient list
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'READ_PATIENT_LIST',
    entityType: 'patient',
    entityId: 'list',
    afterState: { count: result.data.length, page, q, clinicianDoctorId },
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
  // The patient row and its audit entry commit together or not at all
  return withTransaction(async (client) => {
    const patient = await patientRepository.createPatient(data, client);
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CREATE_PATIENT',
        entityType: 'patient',
        entityId: patient.id,
        afterState: patient,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return patient;
  });
}

export async function updatePatient(id, data, { user, reqMeta }) {
  if (!patientRepository.hasUpdatableFields(data)) {
    throw new ValidationError('At least one field must be provided to update patient demographics.');
  }

  // Lock the row, update it and write the before/after audit entry in ONE transaction
  return withTransaction(async (client) => {
    const current = await patientRepository.getPatientForUpdate(id, client);
    if (!current) {
      throw new NotFoundError(`Patient with ID '${id}' not found`);
    }
    const updated = await patientRepository.updatePatient(id, data, client);
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'UPDATE_PATIENT',
        entityType: 'patient',
        entityId: id,
        beforeState: current,
        afterState: updated,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return updated;
  });
}

export default {
  listPatients,
  getPatient,
  createPatient,
  updatePatient,
};
