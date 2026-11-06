import patientRepository from '../repositories/patientRepository.js';
import auditService from './auditService.js';
import { NotFoundError } from '../errors/AppError.js';
import { query } from '../config/db.js';

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

export async function updatePatient(id, data, { user, reqMeta }) {
  const current = await patientRepository.getPatientById(id);
  if (!current) {
    throw new NotFoundError(`Patient with ID '${id}' not found`);
  }

  const fields = [];
  const values = [];

  if (data.fullName !== undefined) {
    values.push(data.fullName);
    fields.push(`full_name = $${values.length}`);
  }
  if (data.phone !== undefined) {
    values.push(data.phone);
    fields.push(`phone = $${values.length}`);
  }
  if (data.email !== undefined) {
    values.push(data.email || null);
    fields.push(`email = $${values.length}`);
  }
  if (data.address !== undefined) {
    values.push(data.address || null);
    fields.push(`address = $${values.length}`);
  }
  if (data.emergencyContactName !== undefined) {
    values.push(data.emergencyContactName || null);
    fields.push(`emergency_contact_name = $${values.length}`);
  }
  if (data.emergencyContactPhone !== undefined) {
    values.push(data.emergencyContactPhone || null);
    fields.push(`emergency_contact_phone = $${values.length}`);
  }
  if (data.bloodGroup !== undefined) {
    values.push(data.bloodGroup || null);
    fields.push(`blood_group = $${values.length}`);
  }
  if (data.allergies !== undefined) {
    values.push(data.allergies || null);
    fields.push(`allergies = $${values.length}`);
  }

  values.push(id);
  const sql = `
    UPDATE patients
    SET ${fields.join(', ')}, updated_at = clock_timestamp()
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const result = await query(sql, values);
  const updated = result.rows[0];

  // Audit patient update with before and after state
  await auditService.logAction({
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
  });

  return updated;
}

export default {
  listPatients,
  getPatient,
  createPatient,
  updatePatient,
};
