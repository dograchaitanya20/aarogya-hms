import appointmentRepository from '../repositories/appointmentRepository.js';
import doctorRepository from '../repositories/doctorRepository.js';
import patientRepository from '../repositories/patientRepository.js';
import scheduleRepository from '../repositories/scheduleRepository.js';
import auditService from './auditService.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  InvalidTransitionError,
} from '../errors/AppError.js';
import {
  getHospitalDayOfWeek,
  utcToHospitalTimeStr,
} from '../utils/timezone.js';

// Valid Appointment State Machine Transitions
const ALLOWED_TRANSITIONS = {
  scheduled: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_consultation', 'cancelled'],
  in_consultation: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function validateSlotAlignment(doctor, startsAtUtc, endsAtUtc) {
  const now = new Date();
  if (startsAtUtc <= now) {
    throw new ValidationError('Appointment slot must be in the future.');
  }

  const durationMinutes = Math.round((endsAtUtc - startsAtUtc) / (60 * 1000));
  if (durationMinutes <= 0) {
    throw new ValidationError('Appointment end time must be after start time.');
  }

  const dayOfWeek = getHospitalDayOfWeek(startsAtUtc);
  const schedules = await scheduleRepository.getSchedulesByDoctorId(doctor.id);
  const matchingSchedule = schedules.find((s) => s.day_of_week === dayOfWeek);

  if (!matchingSchedule) {
    throw new ValidationError(
      `Doctor ${doctor.doctor_name} has no working schedule on day of week ${dayOfWeek}.`
    );
  }

  if (durationMinutes !== matchingSchedule.slot_duration_minutes) {
    throw new ValidationError(
      `Appointment duration (${durationMinutes}m) must exactly match doctor's slot duration (${matchingSchedule.slot_duration_minutes}m).`
    );
  }

  const localStartTime = utcToHospitalTimeStr(startsAtUtc);
  const localEndTime = utcToHospitalTimeStr(endsAtUtc);

  if (localStartTime < matchingSchedule.start_time || localEndTime > matchingSchedule.end_time) {
    throw new ValidationError(
      `Requested slot (${localStartTime} - ${localEndTime}) is outside doctor's working hours (${matchingSchedule.start_time} - ${matchingSchedule.end_time}).`
    );
  }

  // Check alignment to slot_duration_minutes grid
  const [startH, startM] = matchingSchedule.start_time.split(':').map(Number);
  const [slotH, slotM] = localStartTime.split(':').map(Number);

  const scheduleStartTotalM = startH * 60 + startM;
  const slotStartTotalM = slotH * 60 + slotM;
  const offsetMinutes = slotStartTotalM - scheduleStartTotalM;

  if (offsetMinutes % matchingSchedule.slot_duration_minutes !== 0) {
    throw new ValidationError(
      `Slot start time ${localStartTime} is not aligned to the ${matchingSchedule.slot_duration_minutes}-minute slot grid.`
    );
  }

  return matchingSchedule;
}

export async function bookAppointment({
  patientId,
  doctorId,
  startsAt,
  endsAt,
  reasonForVisit,
  user,
  reqMeta,
}) {
  // Authorization: front_desk only
  if (user.role !== 'front_desk') {
    throw new ForbiddenError(
      `Only front_desk staff may book appointments. Role '${user.role}' is not authorized.`
    );
  }

  const patient = await patientRepository.getPatientById(patientId);
  if (!patient || !patient.is_active) {
    throw new NotFoundError(`Patient with ID '${patientId}' not found or inactive.`);
  }

  const doctor = await doctorRepository.getDoctorById(doctorId);
  if (!doctor || !doctor.is_active) {
    throw new NotFoundError(`Doctor with ID '${doctorId}' not found or inactive.`);
  }

  const startsAtUtc = new Date(startsAt);
  const endsAtUtc = new Date(endsAt);

  if (isNaN(startsAtUtc.getTime()) || isNaN(endsAtUtc.getTime())) {
    throw new ValidationError('Invalid startsAt or endsAt datetime format.');
  }

  // Validate slot rules (in future, inside schedule, aligned)
  await validateSlotAlignment(doctor, startsAtUtc, endsAtUtc);

  // Generate unique appointment number
  const aptNumber = `APT-${Date.now().toString().slice(-6)}-${Math.floor(
    Math.random() * 900 + 100
  )}`;

  const appointment = await appointmentRepository.createAppointment({
    appointmentNumber: aptNumber,
    patientId: patient.id,
    doctorId: doctor.id,
    departmentId: doctor.department_id,
    startsAt: startsAtUtc.toISOString(),
    endsAt: endsAtUtc.toISOString(),
    reasonForVisit: reasonForVisit || 'General clinical consultation',
    createdBy: user.id,
  });

  // Audit appointment booking
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'CREATE_APPOINTMENT',
    entityType: 'appointment',
    entityId: appointment.id,
    afterState: appointment,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return appointment;
}

export async function rescheduleAppointment({
  id,
  startsAt,
  endsAt,
  expectedVersion,
  user,
  reqMeta,
}) {
  const current = await appointmentRepository.findAppointmentById(id);
  if (!current) {
    throw new NotFoundError(`Appointment with ID '${id}' not found.`);
  }

  // RBAC: front_desk only can reschedule
  if (user.role !== 'front_desk') {
    throw new ForbiddenError('Only front_desk staff are authorized to reschedule appointments.');
  }

  // Only 'scheduled' or 'checked_in' appointments can be rescheduled
  if (current.status !== 'scheduled' && current.status !== 'checked_in') {
    throw new InvalidTransitionError(
      `Cannot reschedule appointment with status '${current.status}'. Only scheduled or checked_in appointments can be rescheduled.`
    );
  }

  const doctor = await doctorRepository.getDoctorById(current.doctor_id);
  const startsAtUtc = new Date(startsAt);
  const endsAtUtc = new Date(endsAt);

  if (isNaN(startsAtUtc.getTime()) || isNaN(endsAtUtc.getTime())) {
    throw new ValidationError('Invalid startsAt or endsAt datetime format.');
  }

  // Validate new slot
  await validateSlotAlignment(doctor, startsAtUtc, endsAtUtc);

  // Single transaction reschedule with optimistic version check
  const updated = await appointmentRepository.rescheduleAppointment({
    id,
    startsAt: startsAtUtc.toISOString(),
    endsAt: endsAtUtc.toISOString(),
    expectedVersion: Number(expectedVersion),
  });

  // Audit reschedule
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'RESCHEDULE_APPOINTMENT',
    entityType: 'appointment',
    entityId: id,
    beforeState: { starts_at: current.starts_at, ends_at: current.ends_at, version: current.version },
    afterState: { starts_at: updated.starts_at, ends_at: updated.ends_at, version: updated.version },
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return updated;
}

export async function updateStatus({ id, status, cancellationReason, user, reqMeta }) {
  const current = await appointmentRepository.findAppointmentById(id);
  if (!current) {
    throw new NotFoundError(`Appointment with ID '${id}' not found.`);
  }

  // Validate State Machine Transition
  const allowed = ALLOWED_TRANSITIONS[current.status] || [];
  if (!allowed.includes(status)) {
    throw new InvalidTransitionError(
      `Invalid transition from '${current.status}' to '${status}'. Allowed: [${allowed.join(', ')}]`
    );
  }

  if (status === 'cancelled' && (!cancellationReason || !cancellationReason.trim())) {
    throw new ValidationError('A cancellation reason is required when cancelling an appointment.');
  }

  // Role Permissions
  if (user.role === 'admin') {
    throw new ForbiddenError('Admin users have read-only access to appointments.');
  }

  if (user.role === 'clinician') {
    // Clinicians can only update their own appointments
    if (user.doctor_id !== current.doctor_id) {
      throw new ForbiddenError('Clinicians may only update appointments assigned to themselves.');
    }
    // Clinicians may perform: in_consultation, completed, cancelled
    if (status !== 'in_consultation' && status !== 'completed' && status !== 'cancelled') {
      throw new ForbiddenError(
        `Clinicians cannot set status to '${status}'. Front desk staff must handle reception workflows.`
      );
    }
  }

  if (user.role === 'front_desk') {
    // Front desk can do: checked_in, cancelled, no_show
    if (status === 'in_consultation' || status === 'completed') {
      throw new ForbiddenError(
        `Front desk staff cannot set status to '${status}'. Consultations must be conducted by the clinician.`
      );
    }
  }

  const nowIso = new Date().toISOString();
  const checkedInAt = status === 'checked_in' ? nowIso : null;
  const completedAt = status === 'completed' ? nowIso : null;

  const updated = await appointmentRepository.updateAppointmentStatus({
    id,
    status,
    cancellationReason: cancellationReason ? cancellationReason.trim() : null,
    checkedInAt,
    completedAt,
  });

  // Audit state transition
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: status === 'cancelled' ? 'CANCEL_APPOINTMENT' : 'UPDATE_APPOINTMENT_STATUS',
    entityType: 'appointment',
    entityId: id,
    beforeState: { status: current.status, version: current.version },
    afterState: { status: updated.status, cancellationReason, version: updated.version },
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return updated;
}

export async function getAppointments(filters, user) {
  // If user is clinician, force doctorId filter to own appointments
  const effectiveFilters = { ...filters };
  if (user.role === 'clinician') {
    effectiveFilters.doctorId = user.doctor_id;
  }
  return await appointmentRepository.listAppointments(effectiveFilters);
}

export async function getAppointmentById(id, user) {
  const apt = await appointmentRepository.findAppointmentById(id);
  if (!apt) {
    throw new NotFoundError(`Appointment with ID '${id}' not found.`);
  }

  // Clinician can only view own appointments
  if (user.role === 'clinician' && apt.doctor_id !== user.doctor_id) {
    throw new ForbiddenError('Clinicians may only view their own appointments.');
  }

  return apt;
}

export default {
  bookAppointment,
  rescheduleAppointment,
  updateStatus,
  getAppointments,
  getAppointmentById,
  validateSlotAlignment,
};
