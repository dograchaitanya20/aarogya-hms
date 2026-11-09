import { withTransaction } from '../utils/transaction.js';
import appointmentRepository from '../repositories/appointmentRepository.js';
import doctorRepository from '../repositories/doctorRepository.js';
import patientRepository from '../repositories/patientRepository.js';
import scheduleRepository from '../repositories/scheduleRepository.js';
import clinicalRepository from '../repositories/clinicalRepository.js';
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

// Valid Appointment State Machine Transitions (strict AGENTS.md compliance)
const ALLOWED_TRANSITIONS = {
  scheduled: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_consultation', 'cancelled'],
  in_consultation: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function withDeadlockRetry(fn, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      if (err.code === '40P01' && attempt < maxRetries) {
        // Deadlock detected - brief random backoff then retry
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 30 + 10));
        continue;
      }
      throw err;
    }
  }
}

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
  const daySchedules = schedules.filter((s) => s.day_of_week === dayOfWeek);

  if (daySchedules.length === 0) {
    throw new ValidationError(
      `Doctor ${doctor.doctor_name} has no working schedule on day of week ${dayOfWeek}.`
    );
  }

  const localStartTime = utcToHospitalTimeStr(startsAtUtc);
  const localEndTime = utcToHospitalTimeStr(endsAtUtc);

  // Pick the schedule rule that CONTAINS the requested slot
  const matchingSchedule = daySchedules.find(
    (s) => localStartTime >= s.start_time && localEndTime <= s.end_time
  );

  if (!matchingSchedule) {
    throw new ValidationError(
      `Requested slot (${localStartTime} - ${localEndTime}) is outside doctor's working schedule on this day.`
    );
  }

  if (durationMinutes !== matchingSchedule.slot_duration_minutes) {
    throw new ValidationError(
      `Appointment duration (${durationMinutes}m) must exactly match doctor's slot duration (${matchingSchedule.slot_duration_minutes}m).`
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
    await auditService.logPermissionDenied({
      actorId: user.id,
      actorRole: user.role,
      resource: 'appointment',
      action: 'POST',
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      requestId: reqMeta.requestId,
      details: { requiredRole: 'front_desk', actualRole: user.role },
    });
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

  // Transaction wrapping with deadlock retry & consistent advisory locks (Doctor 1, Patient 2)
  return await withDeadlockRetry(async () => {
    return withTransaction(async (client) => {
      // Locks are taken in one fixed order (doctor, then patient) so concurrent requests cannot deadlock
      await appointmentRepository.lockBookingResources(client, doctor.id, patient.id);

      const appointment = await appointmentRepository.createAppointment(
        {
          appointmentNumber: null, // Let PostgreSQL sequence seq_appointment_number generate it
          patientId: patient.id,
          doctorId: doctor.id,
          departmentId: doctor.department_id,
          startsAt: startsAtUtc.toISOString(),
          endsAt: endsAtUtc.toISOString(),
          reasonForVisit: reasonForVisit || 'General clinical consultation',
          createdBy: user.id,
        },
        client
      );

      await auditService.logAction(
        {
          actorId: user.id,
          actorRole: user.role,
          action: 'CREATE_APPOINTMENT',
          entityType: 'appointment',
          entityId: appointment.id,
          afterState: appointment,
          ipAddress: reqMeta.ip,
          userAgent: reqMeta.userAgent,
          requestId: reqMeta.requestId,
        },
        client
      );

      return appointment;
    });
  });
}

export async function rescheduleAppointment({
  id,
  startsAt,
  endsAt,
  expectedVersion,
  user,
  reqMeta,
}) {
  // Authorization check FIRST before reading or validating state
  if (user.role !== 'front_desk') {
    await auditService.logPermissionDenied({
      actorId: user.id,
      actorRole: user.role,
      resource: `appointment/${id}/reschedule`,
      action: 'PATCH',
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      requestId: reqMeta.requestId,
      details: { requiredRole: 'front_desk', actualRole: user.role },
    });
    throw new ForbiddenError('Only front_desk staff are authorized to reschedule appointments.');
  }

  const current = await appointmentRepository.findAppointmentById(id);
  if (!current) {
    throw new NotFoundError(`Appointment with ID '${id}' not found.`);
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

  // Transaction wrapping with deadlock retry & consistent advisory locks (Doctor 1, Patient 2)
  return await withDeadlockRetry(async () => {
    return withTransaction(async (client) => {
      await appointmentRepository.lockBookingResources(client, current.doctor_id, current.patient_id);

      const updated = await appointmentRepository.rescheduleAppointment(
        {
          id,
          startsAt: startsAtUtc.toISOString(),
          endsAt: endsAtUtc.toISOString(),
          expectedVersion: Number(expectedVersion),
        },
        client
      );

      await auditService.logAction(
        {
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
        },
        client
      );

      return updated;
    });
  });
}

export async function updateStatus({
  id,
  status,
  cancellationReason,
  expectedStatus = null,
  expectedVersion = null,
  user,
  reqMeta,
}) {
  // Authorization check (role, ownership) FIRST before reading or state-machine validation
  if (user.role === 'admin') {
    await auditService.logPermissionDenied({
      actorId: user.id,
      actorRole: user.role,
      resource: `appointment/${id}/status`,
      action: 'PATCH',
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      requestId: reqMeta.requestId,
      details: { reason: 'Admin users have read-only access to appointments.' },
    });
    throw new ForbiddenError('Admin users have read-only access to appointments.');
  }

  const current = await appointmentRepository.findAppointmentById(id);
  if (!current) {
    throw new NotFoundError(`Appointment with ID '${id}' not found.`);
  }

  if (user.role === 'clinician') {
    // Clinicians can only update their own appointments
    if (user.doctor_id !== current.doctor_id) {
      await auditService.logPermissionDenied({
        actorId: user.id,
        actorRole: user.role,
        resource: `appointment/${id}/status`,
        action: 'PATCH',
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
        details: { reason: 'Clinicians may only update appointments assigned to themselves.', doctorId: current.doctor_id },
      });
      throw new ForbiddenError('Clinicians may only update appointments assigned to themselves.');
    }

    // Clinicians may ONLY move own appointments: scheduled/checked_in -> in_consultation, in_consultation -> completed
    if (status !== 'in_consultation' && status !== 'completed') {
      await auditService.logPermissionDenied({
        actorId: user.id,
        actorRole: user.role,
        resource: `appointment/${id}/status`,
        action: 'PATCH',
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
        details: { reason: `Clinicians may only set status to 'in_consultation' or 'completed'. Requested: '${status}'.` },
      });
      throw new ForbiddenError(
        `Clinicians may only start ('in_consultation') or complete ('completed') their own consultations.`
      );
    }
  }

  if (user.role === 'front_desk') {
    // Front desk can do: checked_in, cancelled, no_show
    if (status === 'in_consultation' || status === 'completed') {
      await auditService.logPermissionDenied({
        actorId: user.id,
        actorRole: user.role,
        resource: `appointment/${id}/status`,
        action: 'PATCH',
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
        details: { reason: `Front desk staff cannot set status to '${status}'.` },
      });
      throw new ForbiddenError(
        `Front desk staff cannot set status to '${status}'. Consultations must be conducted by the clinician.`
      );
    }
  }

  // Validate State Machine Transition AFTER authorization
  const allowed = ALLOWED_TRANSITIONS[current.status] || [];
  if (!allowed.includes(status)) {
    throw new InvalidTransitionError(
      `Invalid transition from '${current.status}' to '${status}'. Allowed: [${allowed.join(', ')}]`
    );
  }

  if (status === 'cancelled' && (!cancellationReason || !cancellationReason.trim())) {
    throw new ValidationError('A cancellation reason is required when cancelling an appointment.');
  }

  const nowIso = new Date().toISOString();
  const checkedInAt = status === 'checked_in' ? nowIso : null;
  const completedAt = status === 'completed' ? nowIso : null;

  // Transaction wrapping: status update (with expectedStatus check) + audit in ONE transaction
  return withTransaction(async (client) => {
    const updated = await appointmentRepository.updateAppointmentStatus(
      {
        id,
        status,
        expectedStatus: expectedStatus || current.status,
        expectedVersion: expectedVersion || null,
        cancellationReason: cancellationReason ? cancellationReason.trim() : null,
        checkedInAt,
        completedAt,
      },
      client
    );

    // Encounter lifecycle lives in the same transaction as the status change:
    // starting a consultation opens an encounter, completing it closes the encounter.
    if (status === 'in_consultation') {
      const encounter = await clinicalRepository.insertEncounter(
        { appointmentId: id, patientId: current.patient_id, doctorId: current.doctor_id },
        client
      );
      if (encounter) {
        await auditService.logAction(
          {
            actorId: user.id,
            actorRole: user.role,
            action: 'CREATE_ENCOUNTER',
            entityType: 'encounter',
            entityId: encounter.id,
            afterState: { appointmentId: id, patientId: current.patient_id },
            ipAddress: reqMeta.ip,
            userAgent: reqMeta.userAgent,
            requestId: reqMeta.requestId,
          },
          client
        );
      }
    }
    if (status === 'completed') {
      await clinicalRepository.completeEncounterByAppointment(id, client);
    }

    await auditService.logAction(
      {
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
      },
      client
    );

    return updated;
  });
}

export async function getAppointments(filters, user) {
  const effectiveFilters = { ...filters };
  if (user.role === 'clinician') {
    effectiveFilters.doctorId = user.doctor_id;
  }
  return await appointmentRepository.listAppointments(effectiveFilters);
}

export async function getAppointmentById(id, user, reqMeta = {}) {
  // Clinician ownership check
  if (user.role === 'clinician') {
    const apt = await appointmentRepository.findAppointmentById(id);
    if (!apt) {
      throw new NotFoundError(`Appointment with ID '${id}' not found.`);
    }
    if (apt.doctor_id !== user.doctor_id) {
      await auditService.logPermissionDenied({
        actorId: user.id,
        actorRole: user.role,
        resource: `appointment/${id}`,
        action: 'GET',
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
        details: { reason: 'Clinicians may only view their own appointments.' },
      });
      throw new ForbiddenError('Clinicians may only view their own appointments.');
    }
    return apt;
  }

  const apt = await appointmentRepository.findAppointmentById(id);
  if (!apt) {
    throw new NotFoundError(`Appointment with ID '${id}' not found.`);
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
