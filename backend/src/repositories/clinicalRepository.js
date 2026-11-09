import { query } from '../config/db.js';

export async function findEncounterById(id, client = null) {
  const runner = client || { query };
  const res = await runner.query('SELECT * FROM encounters WHERE id = $1', [id]);
  return res.rows[0] || null;
}

// One encounter per appointment (UNIQUE). Re-starting a consultation is a no-op.
export async function insertEncounter({ appointmentId, patientId, doctorId }, client) {
  const res = await client.query(
    `INSERT INTO encounters (appointment_id, patient_id, doctor_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (appointment_id) DO NOTHING
     RETURNING *`,
    [appointmentId, patientId, doctorId]
  );
  return res.rows[0] || null;
}

export async function completeEncounterByAppointment(appointmentId, client) {
  await client.query(
    `UPDATE encounters
     SET status = 'completed', ended_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE appointment_id = $1 AND status = 'in_progress'`,
    [appointmentId]
  );
}

// Metadata only: no clinical content is joined here, so it is safe for admin to see.
export async function listEncounters({ page, pageSize, doctorId = null, patientId = null, status = null }) {
  const values = [];
  let where = ' WHERE 1=1';
  if (doctorId) {
    values.push(doctorId);
    where += ` AND e.doctor_id = $${values.length}`;
  }
  if (patientId) {
    values.push(patientId);
    where += ` AND e.patient_id = $${values.length}`;
  }
  if (status) {
    values.push(status);
    where += ` AND e.status = $${values.length}`;
  }
  const base = ` FROM encounters e
    JOIN patients p ON p.id = e.patient_id
    JOIN doctors d ON d.id = e.doctor_id
    JOIN users u ON u.id = d.user_id${where}`;
  const countRes = await query(`SELECT COUNT(*) AS total${base}`, values);
  const total = parseInt(countRes.rows[0].total, 10);
  values.push(pageSize, (page - 1) * pageSize);
  const result = await query(
    `SELECT e.id, e.appointment_id, e.patient_id, e.doctor_id, e.status, e.started_at, e.ended_at,
            p.full_name AS patient_name, p.mrn, u.full_name AS doctor_name
     ${base}
     ORDER BY e.started_at DESC, e.id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { data: result.rows, page, pageSize, total };
}

export async function insertNote(
  { encounterId, patientId, doctorId, chiefComplaint, symptoms, clinicalExamination, assessmentNotes, plan, diagnosisNotes },
  client
) {
  const res = await client.query(
    `INSERT INTO clinical_notes
       (encounter_id, patient_id, doctor_id, chief_complaint, symptoms, clinical_examination, assessment_notes, plan, diagnosis_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [encounterId, patientId, doctorId, chiefComplaint, symptoms || null, clinicalExamination || null, assessmentNotes || null, plan || null, diagnosisNotes]
  );
  return res.rows[0];
}

export async function insertPrescription({ encounterId, patientId, doctorId, instructions }, client) {
  const res = await client.query(
    `INSERT INTO prescriptions (encounter_id, patient_id, doctor_id, instructions)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [encounterId, patientId, doctorId, instructions || null]
  );
  return res.rows[0];
}

export async function insertPrescriptionItem(
  { prescriptionId, medicineName, dosage, frequency, durationDays, instructions },
  client
) {
  const res = await client.query(
    `INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration_days, instructions)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [prescriptionId, medicineName, dosage, frequency, durationDays, instructions || null]
  );
  return res.rows[0];
}

export async function insertDiagnosticReport(
  { encounterId, patientId, doctorId, testName, category, reportDate, fileName, status, notes },
  client
) {
  const res = await client.query(
    `INSERT INTO diagnostic_reports
       (encounter_id, patient_id, doctor_id, test_name, category, report_date, file_name, status, notes)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9)
     RETURNING *`,
    [encounterId || null, patientId, doctorId, testName, category, reportDate || null, fileName, status, notes || null]
  );
  return res.rows[0];
}

export async function getPatientRecords(patientId) {
  const [encounters, notes, prescriptions, items, reports] = await Promise.all([
    query(
      `SELECT e.*, u.full_name AS doctor_name FROM encounters e
       JOIN doctors d ON d.id = e.doctor_id JOIN users u ON u.id = d.user_id
       WHERE e.patient_id = $1 ORDER BY e.started_at DESC`,
      [patientId]
    ),
    query(
      `SELECT cn.*, u.full_name AS doctor_name FROM clinical_notes cn
       JOIN doctors d ON d.id = cn.doctor_id JOIN users u ON u.id = d.user_id
       WHERE cn.patient_id = $1 ORDER BY cn.created_at DESC`,
      [patientId]
    ),
    query(
      `SELECT rx.*, u.full_name AS doctor_name FROM prescriptions rx
       JOIN doctors d ON d.id = rx.doctor_id JOIN users u ON u.id = d.user_id
       WHERE rx.patient_id = $1 ORDER BY rx.created_at DESC`,
      [patientId]
    ),
    query(
      `SELECT pi.* FROM prescription_items pi
       JOIN prescriptions rx ON rx.id = pi.prescription_id
       WHERE rx.patient_id = $1 ORDER BY pi.created_at, pi.id`,
      [patientId]
    ),
    query(
      `SELECT dr.*, u.full_name AS doctor_name FROM diagnostic_reports dr
       JOIN doctors d ON d.id = dr.doctor_id JOIN users u ON u.id = d.user_id
       WHERE dr.patient_id = $1 ORDER BY dr.report_date DESC, dr.created_at DESC`,
      [patientId]
    ),
  ]);

  const itemsByRx = {};
  for (const item of items.rows) {
    (itemsByRx[item.prescription_id] ||= []).push(item);
  }
  return {
    encounters: encounters.rows,
    notes: notes.rows,
    prescriptions: prescriptions.rows.map((rx) => ({ ...rx, items: itemsByRx[rx.id] || [] })),
    reports: reports.rows,
  };
}

export default {
  findEncounterById,
  insertEncounter,
  completeEncounterByAppointment,
  listEncounters,
  insertNote,
  insertPrescription,
  insertPrescriptionItem,
  insertDiagnosticReport,
  getPatientRecords,
};
