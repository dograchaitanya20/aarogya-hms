import clinicalNoteRepository from '../repositories/clinicalNoteRepository.js';
import auditService from './auditService.js';

export async function getNotesByPatient(patientId, { user, reqMeta }) {
  const notes = await clinicalNoteRepository.getNotesByPatient(patientId);

  // Non-negotiable: Log every READ of clinical note
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'READ_CLINICAL_NOTE',
    entityType: 'clinical_note',
    entityId: patientId,
    afterState: { notesCount: notes.length },
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return notes;
}

export default {
  getNotesByPatient,
};
