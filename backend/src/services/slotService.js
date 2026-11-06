import doctorRepository from '../repositories/doctorRepository.js';
import scheduleRepository from '../repositories/scheduleRepository.js';
import {
  hospitalLocalToUtc,
  utcToHospitalDateStr,
  getHospitalDayOfWeek,
} from '../utils/timezone.js';
import { ValidationError, NotFoundError } from '../errors/AppError.js';

export async function computeAvailableSlots({
  doctorId = null,
  departmentId = null,
  fromDateStr,
  toDateStr,
  page = 1,
  pageSize = 50,
}) {
  // Validate dates
  if (!fromDateStr || !toDateStr) {
    throw new ValidationError("Both 'from' and 'to' date parameters are required (YYYY-MM-DD).");
  }

  const fromDate = new Date(`${fromDateStr}T00:00:00Z`);
  const toDate = new Date(`${toDateStr}T00:00:00Z`);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new ValidationError("Invalid date format. Expected 'YYYY-MM-DD'.");
  }

  if (fromDate > toDate) {
    throw new ValidationError("'from' date cannot be after 'to' date.");
  }

  // Range <= 14 days
  const diffDays = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24)) + 1;
  if (diffDays > 14) {
    throw new ValidationError("Date search range cannot exceed 14 days (requested: " + diffDays + " days).");
  }

  // Fetch doctors to compute for
  let doctors = [];
  if (doctorId) {
    const doc = await doctorRepository.getDoctorById(doctorId);
    if (!doc || !doc.is_active) {
      throw new NotFoundError(`Doctor with ID '${doctorId}' not found or inactive.`);
    }
    doctors = [doc];
  } else {
    doctors = await doctorRepository.getAllDoctors({ departmentId, isActive: true });
  }

  const allAvailableSlots = [];
  const now = new Date();

  // Pre-calculate UTC boundary for active appointment lookup
  const rangeStartUtc = hospitalLocalToUtc(fromDateStr, '00:00:00');
  const rangeEndUtc = new Date(hospitalLocalToUtc(toDateStr, '23:59:59').getTime() + 60000);

  for (const doc of doctors) {
    const schedules = await scheduleRepository.getSchedulesByDoctorId(doc.id);
    if (schedules.length === 0) continue;

    // Fetch existing appointments for this doctor in the whole search range
    const activeAppointments = await scheduleRepository.getActiveAppointmentsForDoctorInRange(
      doc.id,
      rangeStartUtc.toISOString(),
      rangeEndUtc.toISOString()
    );

    // Map appointments to interval objects for fast overlap testing
    const bookedIntervals = activeAppointments.map((a) => ({
      startMs: new Date(a.starts_at).getTime(),
      endMs: new Date(a.ends_at).getTime(),
    }));

    // Iterate day-by-day
    const current = new Date(fromDate);
    while (current <= toDate) {
      const currentDateStr = current.toISOString().slice(0, 10);
      const dayOfWeek = getHospitalDayOfWeek(hospitalLocalToUtc(currentDateStr, '12:00:00'));

      const daySchedules = schedules.filter((s) => s.day_of_week === dayOfWeek);

      for (const sched of daySchedules) {
        const slotMinutes = sched.slot_duration_minutes || 15;
        const [startH, startM] = sched.start_time.split(':').map(Number);
        const [endH, endM] = sched.end_time.split(':').map(Number);

        const totalStartMinutes = startH * 60 + startM;
        const totalEndMinutes = endH * 60 + endM;

        for (
          let minuteCursor = totalStartMinutes;
          minuteCursor + slotMinutes <= totalEndMinutes;
          minuteCursor += slotMinutes
        ) {
          const slotStartH = String(Math.floor(minuteCursor / 60)).padStart(2, '0');
          const slotStartM = String(minuteCursor % 60).padStart(2, '0');
          const slotStartTimeStr = `${slotStartH}:${slotStartM}:00`;

          const slotEndMinute = minuteCursor + slotMinutes;
          const slotEndH = String(Math.floor(slotEndMinute / 60)).padStart(2, '0');
          const slotEndM = String(slotEndMinute % 60).padStart(2, '0');
          const slotEndTimeStr = `${slotEndH}:${slotEndM}:00`;

          const slotStartUtc = hospitalLocalToUtc(currentDateStr, slotStartTimeStr);
          const slotEndUtc = hospitalLocalToUtc(currentDateStr, slotEndTimeStr);

          // 1. Exclude past slots
          if (slotStartUtc <= now) {
            continue;
          }

          // 2. Exclude overlapping booked appointments
          const startMs = slotStartUtc.getTime();
          const endMs = slotEndUtc.getTime();

          const isOverlapping = bookedIntervals.some(
            (booked) => startMs < booked.endMs && endMs > booked.startMs
          );

          if (!isOverlapping) {
            allAvailableSlots.push({
              doctorId: doc.id,
              doctorName: doc.doctor_name,
              departmentId: doc.department_id,
              departmentName: doc.department_name,
              startsAt: slotStartUtc.toISOString(),
              endsAt: slotEndUtc.toISOString(),
              localDate: currentDateStr,
              localStartTime: slotStartTimeStr,
              localEndTime: slotEndTimeStr,
              slotDurationMinutes: slotMinutes,
              consultationFeePaise: doc.consultation_fee_paise,
            });
          }
        }
      }

      // Next day
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }

  // Sort chronologically by startsAt
  allAvailableSlots.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  const total = allAvailableSlots.length;
  const offset = (page - 1) * pageSize;
  const paginatedData = allAvailableSlots.slice(offset, offset + pageSize);

  return {
    data: paginatedData,
    page,
    pageSize,
    total,
  };
}

export async function getDoctorSlotsForDate(doctorId, dateStr) {
  const result = await computeAvailableSlots({
    doctorId,
    fromDateStr: dateStr,
    toDateStr: dateStr,
    page: 1,
    pageSize: 100,
  });
  return result.data;
}

export default {
  computeAvailableSlots,
  getDoctorSlotsForDate,
};
