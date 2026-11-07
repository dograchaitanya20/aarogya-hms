import { query } from '../config/db.js';

export async function getSchedulesByDoctorId(doctorId) {
  const sql = `
    SELECT * FROM doctor_schedules
    WHERE doctor_id = $1 AND is_active = true
    ORDER BY day_of_week ASC, start_time ASC;
  `;
  const result = await query(sql, [doctorId]);
  return result.rows;
}

export async function getScheduleById(id) {
  const result = await query('SELECT * FROM doctor_schedules WHERE id = $1;', [id]);
  return result.rows[0] || null;
}

export async function checkOverlappingSchedule(doctorId, dayOfWeek, startTime, endTime, excludeId = null) {
  let sql = `
    SELECT id FROM doctor_schedules
    WHERE doctor_id = $1
      AND day_of_week = $2
      AND is_active = true
      AND (start_time < $4 AND end_time > $3)
  `;
  const values = [doctorId, dayOfWeek, startTime, endTime];

  if (excludeId) {
    values.push(excludeId);
    sql += ` AND id != $${values.length}`;
  }

  sql += ' LIMIT 1;';
  const result = await query(sql, values);
  return result.rows.length > 0;
}

export async function createSchedule({
  doctorId,
  dayOfWeek,
  startTime,
  endTime,
  slotDurationMinutes,
}) {
  const sql = `
    INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const result = await query(sql, [
    doctorId,
    dayOfWeek,
    startTime,
    endTime,
    slotDurationMinutes,
  ]);
  return result.rows[0];
}

export async function updateSchedule(id, updates) {
  const fields = [];
  const values = [];

  if (updates.startTime !== undefined) {
    values.push(updates.startTime);
    fields.push(`start_time = $${values.length}`);
  }
  if (updates.endTime !== undefined) {
    values.push(updates.endTime);
    fields.push(`end_time = $${values.length}`);
  }
  if (updates.slotDurationMinutes !== undefined) {
    values.push(updates.slotDurationMinutes);
    fields.push(`slot_duration_minutes = $${values.length}`);
  }
  if (updates.isActive !== undefined) {
    values.push(updates.isActive);
    fields.push(`is_active = $${values.length}`);
  }

  if (fields.length === 0) return await getScheduleById(id);

  values.push(id);
  const sql = `
    UPDATE doctor_schedules
    SET ${fields.join(', ')}
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const result = await query(sql, values);
  return result.rows[0] || null;
}

export async function deleteSchedule(id) {
  const result = await query(
    'UPDATE doctor_schedules SET is_active = false WHERE id = $1 RETURNING *;',
    [id]
  );
  return result.rows[0] || null;
}

export async function getActiveAppointmentsForDoctorInRange(doctorId, startUtc, endUtc) {
  const sql = `
    SELECT id, starts_at, ends_at, status
    FROM appointments
    WHERE doctor_id = $1
      AND status IN ('scheduled', 'checked_in', 'in_consultation', 'completed')
      AND starts_at < $3
      AND ends_at > $2;
  `;
  const result = await query(sql, [doctorId, startUtc, endUtc]);
  return result.rows;
}

export default {
  getSchedulesByDoctorId,
  getScheduleById,
  checkOverlappingSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getActiveAppointmentsForDoctorInRange,
};
