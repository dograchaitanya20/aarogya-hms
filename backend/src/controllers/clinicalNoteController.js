import clinicalNoteService from '../services/clinicalNoteService.js';

export async function getPatientNotes(req, res, next) {
  try {
    const notes = await clinicalNoteService.getNotesByPatient(req.params.patientId, {
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });

    res.status(200).json({ data: notes });
  } catch (err) {
    next(err);
  }
}

export default {
  getPatientNotes,
};
