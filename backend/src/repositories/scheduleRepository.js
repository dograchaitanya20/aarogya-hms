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
  checkOverlappingSchedule,
  createSchedule,
  getActiveAppointmentsForDoctorInRange,
};
