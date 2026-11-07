import { query } from '../config/db.js';
import { StaleVersionError, NotFoundError, InvalidTransitionError } from '../errors/AppError.js';

export async function findAppointmentById(id, client = null) {
  const runner = client || { query };
  const sql = `
    SELECT a.*,
           p.full_name as patient_name, p.mrn, p.phone as patient_phone,
           u_doc.full_name as doctor_name, d.specialization, d.consultation_fee_paise,
           dept.name as department_name, dept.code as department_code,
           u_created.full_name as created_by_name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors d ON d.id = a.doctor_id
    JOIN users u_doc ON u_doc.id = d.user_id
    JOIN departments dept ON dept.id = a.department_id
    JOIN users u_created ON u_created.id = a.created_by
    WHERE a.id = $1;
  `;
  const result = await runner.query(sql, [id]);
  return result.rows[0] || null;
}

export async function listAppointments({
  status = null,
  doctorId = null,
  patientId = null,
  from = null,
  to = null,
  q = '',
  page = 1,
  pageSize = 20,
}) {
  const offset = (page - 1) * pageSize;
  let sql = `
    SELECT a.*,
           p.full_name as patient_name, p.mrn, p.phone as patient_phone,
           u_doc.full_name as doctor_name, d.specialization,
           dept.name as department_name, dept.code as department_code
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors d ON d.id = a.doctor_id
    JOIN users u_doc ON u_doc.id = d.user_id
    JOIN departments dept ON dept.id = a.department_id
    WHERE 1=1
  `;
  const values = [];

  if (status) {
    values.push(status);
    sql += ` AND a.status = $${values.length}`;
  }

  if (doctorId) {
    values.push(doctorId);
    sql += ` AND a.doctor_id = $${values.length}`;
  }

  if (patientId) {
    values.push(patientId);
    sql += ` AND a.patient_id = $${values.length}`;
  }

  if (from) {
    values.push(from);
    sql += ` AND a.starts_at >= $${values.length}`;
  }

  if (to) {
    values.push(to);
    sql += ` AND a.starts_at <= $${values.length}`;
  }

  if (q && q.trim()) {
    values.push(`%${q.trim()}%`);
    sql += ` AND (p.full_name ILIKE $${values.length} OR p.mrn ILIKE $${values.length} OR a.appointment_number ILIKE $${values.length})`;
  }

  // Count total
  const countRes = await query(
    sql.replace(
      'SELECT a.*,\n           p.full_name as patient_name, p.mrn, p.phone as patient_phone,\n           u_doc.full_name as doctor_name, d.specialization,\n           dept.name as department_name, dept.code as department_code',
      'SELECT COUNT(*) as total'
    ),
    values
  );
  const total = parseInt(countRes.rows[0].total, 10);

  values.push(pageSize);
  sql += ` ORDER BY a.starts_at DESC LIMIT $${values.length}`;
  values.push(offset);
  sql += ` OFFSET $${values.length}`;

  const result = await query(sql, values);
  return {
    data: result.rows,
    page,
    pageSize,
    total,
  };
}

export async function createAppointment(
  {
    appointmentNumber,
    patientId,
    doctorId,
    departmentId,
    startsAt,
    endsAt,
    reasonForVisit,
    createdBy,
  },
  client = null
) {
  const runner = client || { query };
  const sql = `
    INSERT INTO appointments (
      appointment_number, patient_id, doctor_id, department_id,
      starts_at, ends_at, status, reason_for_visit, created_by, version
    )
    VALUES (
      COALESCE($1, 'APT-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(NEXTVAL('seq_appointment_number')::TEXT, 6, '0')),
      $2, $3, $4, $5, $6, 'scheduled', $7, $8, 1
    )
    RETURNING *;
  `;
  const result = await runner.query(sql, [
    appointmentNumber,
    patientId,
    doctorId,
    departmentId,
    startsAt,
    endsAt,
    reasonForVisit,
    createdBy,
  ]);
  return result.rows[0];
}

export async function rescheduleAppointment(
  { id, startsAt, endsAt, expectedVersion },
  client = null
) {
  const runner = client || { query };

  const sql = `
    UPDATE appointments
    SET starts_at = $2, ends_at = $3, version = version + 1, updated_at = clock_timestamp()
    WHERE id = $1 AND version = $4
    RETURNING *;
  `;
  const result = await runner.query(sql, [id, startsAt, endsAt, expectedVersion]);

  if (result.rows.length === 0) {
    // Check if appointment exists
    const checkRes = await runner.query('SELECT version FROM appointments WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      throw new NotFoundError(`Appointment with ID '${id}' not found`);
    }
    throw new StaleVersionError(
      `Appointment was modified by another operation (expected version ${expectedVersion}, current version ${checkRes.rows[0].version})`
    );
  }

  return result.rows[0];
}

export async function updateAppointmentStatus(
  {
    id,
    status,
    expectedStatus = null,
    expectedVersion = null,
    cancellationReason = null,
    checkedInAt = null,
    completedAt = null,
  },
  client = null
) {
  const runner = client || { query };
  let sql = `
    UPDATE appointments
    SET status = $2,
        cancellation_reason = COALESCE($3, cancellation_reason),
        checked_in_at = COALESCE($4, checked_in_at),
        completed_at = COALESCE($5, completed_at),
        version = version + 1,
        updated_at = clock_timestamp()
    WHERE id = $1
  `;
  const params = [id, status, cancellationReason, checkedInAt, completedAt];

  if (expectedStatus) {
    params.push(expectedStatus);
    sql += ` AND status = $${params.length}`;
  }
  if (expectedVersion) {
    params.push(expectedVersion);
    sql += ` AND version = $${params.length}`;
  }

  sql += ' RETURNING *;';

  const result = await runner.query(sql, params);
  if (result.rows.length === 0) {
    const checkRes = await runner.query('SELECT status, version FROM appointments WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      throw new NotFoundError(`Appointment with ID '${id}' not found`);
    }
    if (expectedVersion && checkRes.rows[0].version !== expectedVersion) {
      throw new StaleVersionError(
        `Appointment was modified by another operation (expected version ${expectedVersion}, current version ${checkRes.rows[0].version})`
      );
    }
    throw new InvalidTransitionError(
      `Appointment was concurrently modified (current status '${checkRes.rows[0].status}', expected '${expectedStatus}')`
    );
  }
  return result.rows[0];
}

export default {
  findAppointmentById,
  listAppointments,
  createAppointment,
  rescheduleAppointment,
  updateAppointmentStatus,
};
