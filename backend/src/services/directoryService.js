import bcrypt from 'bcrypt';
import departmentRepository from '../repositories/departmentRepository.js';
import doctorRepository from '../repositories/doctorRepository.js';
import scheduleRepository from '../repositories/scheduleRepository.js';
import auditService from './auditService.js';
import userRepository from '../repositories/userRepository.js';
import { withTransaction } from '../utils/transaction.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../errors/AppError.js';
import { BCRYPT_SALT_ROUNDS } from '../config/env.js';

// Valid slot duration minutes allowed by system
const VALID_SLOT_MINUTES = new Set([10, 15, 20, 30, 45, 60]);

export async function getDepartments() {
  return await departmentRepository.getAllDepartments();
}

export async function createDepartment({ name, code, description, user, reqMeta }) {
  const dept = await departmentRepository.createDepartment({ name, code, description });
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'CREATE_DEPARTMENT',
    entityType: 'department',
    entityId: dept.id,
    afterState: dept,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });
  return dept;
}

export async function listDoctors({ departmentId = null, q = '', isActive = true }) {
  return await doctorRepository.getAllDoctors({ departmentId, q, isActive });
}

export async function createDoctorWithUser({
  email,
  password,
  fullName,
  phone,
  departmentId,
  specialization,
  consultationFeePaise,
  roomNumber,
  user,
  reqMeta,
}) {
  if (await userRepository.emailExists(email)) {
    throw new ConflictError(`User with email '${email}' already exists.`);
  }

  const dept = await departmentRepository.getDepartmentById(departmentId);
  if (!dept) {
    throw new NotFoundError(`Department with ID '${departmentId}' not found.`);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  // ONE transaction: the login account, the doctor profile and the audit entry succeed or fail together.
  // (Otherwise a failure after the first insert would leave a clinician login with no doctor profile.)
  return withTransaction(async (client) => {
    const newUser = await userRepository.createUser(
      { email, passwordHash, role: 'clinician', fullName, phone },
      client
    );
    const doctor = await doctorRepository.createDoctor(
      { userId: newUser.id, departmentId, specialization, consultationFeePaise, roomNumber },
      client
    );
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CREATE_DOCTOR',
        entityType: 'doctor',
        entityId: doctor.id,
        afterState: { doctorId: doctor.id, userId: newUser.id, email: newUser.email },
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return { ...doctor, doctor_name: newUser.full_name, email: newUser.email };
  });
}

export async function createScheduleRule({
  doctorId,
  dayOfWeek,
  startTime,
  endTime,
  slotDurationMinutes,
  user,
  reqMeta,
}) {
  const doctor = await doctorRepository.getDoctorById(doctorId);
  if (!doctor) {
    throw new NotFoundError(`Doctor with ID '${doctorId}' not found.`);
  }

  if (dayOfWeek < 0 || dayOfWeek > 6) {
    throw new ValidationError('dayOfWeek must be an integer between 0 (Sunday) and 6 (Saturday).');
  }

  if (startTime >= endTime) {
    throw new ValidationError('startTime must be strictly before endTime.');
  }

  if (!VALID_SLOT_MINUTES.has(slotDurationMinutes)) {
    throw new ValidationError(
      `slotDurationMinutes must be one of: [${Array.from(VALID_SLOT_MINUTES).join(', ')}].`
    );
  }

  // Check overlapping schedule rule for the same doctor and weekday
  const isOverlapping = await scheduleRepository.checkOverlappingSchedule(
    doctorId,
    dayOfWeek,
    startTime,
    endTime
  );

  if (isOverlapping) {
    throw new ConflictError(
      `Doctor already has an active schedule rule overlapping ${startTime} - ${endTime} on day ${dayOfWeek}.`
    );
  }

  const schedule = await scheduleRepository.createSchedule({
    doctorId,
    dayOfWeek,
    startTime,
    endTime,
    slotDurationMinutes,
  });

  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'CREATE_DOCTOR_SCHEDULE',
    entityType: 'doctor_schedule',
    entityId: schedule.id,
    afterState: schedule,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return schedule;
}

export async function getDoctorSchedules(doctorId) {
  return await scheduleRepository.getSchedulesByDoctorId(doctorId);
}

export async function createStaffUser({ email, password, fullName, phone, role, user, reqMeta }) {
  if (role !== 'front_desk' && role !== 'admin') {
    throw new ValidationError("Staff role must be either 'front_desk' or 'admin'.");
  }

  if (await userRepository.emailExists(email)) {
    throw new ConflictError(`User with email '${email}' already exists.`);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  return withTransaction(async (client) => {
    const createdStaff = await userRepository.createUser({ email, passwordHash, role, fullName, phone }, client);
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CREATE_STAFF_USER',
        entityType: 'user',
        entityId: createdStaff.id,
        afterState: createdStaff,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return createdStaff;
  });
}

export async function setStaffActiveStatus({ id, isActive, user, reqMeta }) {
  if (id === user.id && !isActive) {
    throw new ConflictError('You cannot deactivate your own account.', 'CANNOT_DEACTIVATE_SELF');
  }

  return withTransaction(async (client) => {
    const current = await userRepository.findStaffForUpdate(id, client);
    if (!current) {
      throw new NotFoundError(`User with ID '${id}' not found.`);
    }
    const updatedStaff = await userRepository.setActive(id, isActive, client);
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'UPDATE_STAFF_STATUS',
        entityType: 'user',
        entityId: id,
        beforeState: current,
        afterState: updatedStaff,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return updatedStaff;
  });
}

export async function listStaff(filters) {
  return userRepository.listStaff(filters);
}

export async function getDoctorById(id) {
  const doctor = await doctorRepository.getDoctorById(id);
  if (!doctor) {
    throw new NotFoundError(`Doctor with ID '${id}' not found.`);
  }
  return doctor;
}

export async function updateDepartment(id, updates, { user, reqMeta }) {
  const current = await departmentRepository.getDepartmentById(id);
  if (!current) {
    throw new NotFoundError(`Department with ID '${id}' not found.`);
  }
  const updated = await departmentRepository.updateDepartment(id, updates);
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'UPDATE_DEPARTMENT',
    entityType: 'department',
    entityId: id,
    beforeState: current,
    afterState: updated,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });
  return updated;
}

export async function deleteDepartment(id, { user, reqMeta }) {
  const current = await departmentRepository.getDepartmentById(id);
  if (!current) {
    throw new NotFoundError(`Department with ID '${id}' not found.`);
  }
  const deleted = await departmentRepository.deleteDepartment(id);
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'DELETE_DEPARTMENT',
    entityType: 'department',
    entityId: id,
    beforeState: current,
    afterState: deleted,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });
  return deleted;
}

export async function updateDoctor(id, updates, { user, reqMeta }) {
  const current = await doctorRepository.getDoctorById(id);
  if (!current) {
    throw new NotFoundError(`Doctor with ID '${id}' not found.`);
  }
  return withTransaction(async (client) => {
    const updated = await doctorRepository.updateDoctor(id, updates, client);
    // Access follows status: a deactivated doctor's login stops working, a reactivated one's resumes
    if (updates.isActive !== undefined) {
      await userRepository.setActive(current.user_id, updates.isActive, client);
    }
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'UPDATE_DOCTOR',
        entityType: 'doctor',
        entityId: id,
        beforeState: current,
        afterState: updated,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return updated;
  });
}

export async function deleteDoctor(id, { user, reqMeta }) {
  const current = await doctorRepository.getDoctorById(id);
  if (!current) {
    throw new NotFoundError(`Doctor with ID '${id}' not found.`);
  }
  return withTransaction(async (client) => {
    const deleted = await doctorRepository.deleteDoctor(id, client);
    // Revoke access: without this the removed doctor could still sign in and read their patients
    await userRepository.setActive(current.user_id, false, client);
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'DELETE_DOCTOR',
        entityType: 'doctor',
        entityId: id,
        beforeState: current,
        afterState: deleted,
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return deleted;
  });
}

export async function updateSchedule(id, updates, { user, reqMeta }) {
  const current = await scheduleRepository.getScheduleById(id);
  if (!current) {
    throw new NotFoundError(`Schedule with ID '${id}' not found.`);
  }
  const updated = await scheduleRepository.updateSchedule(id, updates);
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'UPDATE_DOCTOR_SCHEDULE',
    entityType: 'doctor_schedule',
    entityId: id,
    beforeState: current,
    afterState: updated,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });
  return updated;
}

export async function deleteSchedule(id, { user, reqMeta }) {
  const current = await scheduleRepository.getScheduleById(id);
  if (!current) {
    throw new NotFoundError(`Schedule with ID '${id}' not found.`);
  }
  const deleted = await scheduleRepository.deleteSchedule(id);
  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'DELETE_DOCTOR_SCHEDULE',
    entityType: 'doctor_schedule',
    entityId: id,
    beforeState: current,
    afterState: deleted,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });
  return deleted;
}

export default {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  listDoctors,
  getDoctorById,
  createDoctorWithUser,
  updateDoctor,
  deleteDoctor,
  createScheduleRule,
  updateSchedule,
  deleteSchedule,
  getDoctorSchedules,
  createStaffUser,
  setStaffActiveStatus,
  listStaff,
};
