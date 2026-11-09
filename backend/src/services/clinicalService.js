import clinicalRepository from '../repositories/clinicalRepository.js';
import userRepository from '../repositories/userRepository.js';
import auditService from './auditService.js';
import { withTransaction } from '../utils/transaction.js';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../errors/AppError.js';

// NOTE: audit entries for clinical writes contain IDs and counts only, never note/prescription text.
// The audit log is readable by admin, and admin must not be able to read clinical content.

async function denyAndThrow(user, reqMeta, resource, reason, details = {}) {
  await auditService.logPermissionDenied({
    actorId: user.id,
    actorRole: user.role,
    resource,
    action: 'WRITE',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
    details: { reason, ...details },
  });
  throw new ForbiddenError(reason);
}

// Clinician may only write into an encounter that is theirs and still open
async function loadOwnOpenEncounter(encounterId, user, reqMeta) {
  const encounter = await clinicalRepository.findEncounterById(encounterId);
  if (!encounter) {
    throw new NotFoundError(`Encounter with ID '${encounterId}' not found.`);
  }
  if (encounter.doctor_id !== user.doctor_id) {
    await denyAndThrow(user, reqMeta, `encounter/${encounterId}`, 'Clinicians may only write to their own encounters.');
  }
  if (encounter.status !== 'in_progress') {
    throw new ConflictError('This encounter is closed; no further notes or prescriptions can be added.', 'ENCOUNTER_CLOSED');
  }
  return encounter;
}

export async function addNote({ encounterId, data, user, reqMeta }) {
  const encounter = await loadOwnOpenEncounter(encounterId, user, reqMeta);
  return withTransaction(async (client) => {
    const note = await clinicalRepository.insertNote(
      { encounterId, patientId: encounter.patient_id, doctorId: encounter.doctor_id, ...data },
      client
    );
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CREATE_CLINICAL_NOTE',
        entityType: 'clinical_note',
        entityId: note.id,
        afterState: { encounterId, patientId: encounter.patient_id },
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return note;
  });
}

export async function addPrescription({ encounterId, data, user, reqMeta }) {
  const encounter = await loadOwnOpenEncounter(encounterId, user, reqMeta);
  return withTransaction(async (client) => {
    const prescription = await clinicalRepository.insertPrescription(
      {
        encounterId,
        patientId: encounter.patient_id,
        doctorId: encounter.doctor_id,
        instructions: data.instructions,
      },
      client
    );
    const items = [];
    for (const item of data.items) {
      items.push(await clinicalRepository.insertPrescriptionItem({ prescriptionId: prescription.id, ...item }, client));
    }
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CREATE_PRESCRIPTION',
        entityType: 'prescription',
        entityId: prescription.id,
        afterState: { encounterId, patientId: encounter.patient_id, itemCount: items.length },
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return { ...prescription, items };
  });
}

export async function addDiagnosticReport({ data, user, reqMeta }) {
  const hasAccess = await userRepository.checkClinicianPatientAccess(user.id, data.patientId);
  if (!hasAccess) {
    await denyAndThrow(user, reqMeta, 'diagnostic_report', 'Clinicians may only add reports for patients they treat.', {
      patientId: data.patientId,
    });
  }
  if (data.encounterId) {
    const encounter = await clinicalRepository.findEncounterById(data.encounterId);
    if (!encounter || encounter.patient_id !== data.patientId || encounter.doctor_id !== user.doctor_id) {
      throw new ValidationError('encounterId must be one of your own encounters for this patient.');
    }
  }
  return withTransaction(async (client) => {
    const report = await clinicalRepository.insertDiagnosticReport({ ...data, doctorId: user.doctor_id }, client);
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CREATE_DIAGNOSTIC_REPORT',
        entityType: 'diagnostic_report',
        entityId: report.id,
        afterState: { patientId: data.patientId, category: data.category },
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return report;
  });
}

// Route middleware has already checked the clinician-patient relationship
export async function getPatientRecords({ patientId, user, reqMeta }) {
  const records = await clinicalRepository.getPatientRecords(patientId);
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'READ_CLINICAL_RECORD',
    entityType: 'patient',
    entityId: patientId,
    afterState: {
      encounters: records.encounters.length,
      notes: records.notes.length,
      prescriptions: records.prescriptions.length,
      reports: records.reports.length,
    },
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });
  return records;
}

export async function listEncounters({ page, pageSize, patientId, status, user }) {
  // Admin sees metadata only (this query never touches clinical content); clinician sees their own.
  return clinicalRepository.listEncounters({
    page,
    pageSize,
    patientId,
    status,
    doctorId: user.role === 'clinician' ? user.doctor_id : null,
  });
}

export default { addNote, addPrescription, addDiagnosticReport, getPatientRecords, listEncounters };
