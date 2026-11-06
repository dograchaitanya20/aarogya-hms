import bcrypt from 'bcrypt';
import departmentRepository from '../repositories/departmentRepository.js';
import doctorRepository from '../repositories/doctorRepository.js';
import scheduleRepository from '../repositories/scheduleRepository.js';
import auditService from './auditService.js';
import { query } from '../config/db.js';
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
  const existingUserRes = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (existingUserRes.rows.length > 0) {
    throw new ConflictError(`User with email '${email}' already exists.`);
  }

  const dept = await query('SELECT id FROM departments WHERE id = $1', [departmentId]);
  if (dept.rows.length === 0) {
    throw new NotFoundError(`Department with ID '${departmentId}' not found.`);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  // Single transaction: create user with role 'clinician' and doctor profile
  const userRes = await query(
    `
    INSERT INTO users (email, password_hash, role, full_name, phone)
    VALUES ($1, $2, 'clinician', $3, $4)
    RETURNING id, email, role, full_name, phone;
    `,
    [email, passwordHash, fullName, phone]
  );
  const newUser = userRes.rows[0];

  const doctor = await doctorRepository.createDoctor({
    userId: newUser.id,
    departmentId,
    specialization,
    consultationFeePaise,
    roomNumber,
  });

  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'CREATE_DOCTOR',
    entityType: 'doctor',
    entityId: doctor.id,
    afterState: { doctorId: doctor.id, userId: newUser.id, email: newUser.email },
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return {
    ...doctor,
    doctor_name: newUser.full_name,
    email: newUser.email,
  };
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

  const existingRes = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (existingRes.rows.length > 0) {
    throw new ConflictError(`User with email '${email}' already exists.`);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const res = await query(
    `
    INSERT INTO users (email, password_hash, role, full_name, phone)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, email, role, full_name, phone, is_active, created_at;
    `,
    [email, passwordHash, role, fullName, phone]
  );
  const createdStaff = res.rows[0];

  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'CREATE_STAFF_USER',
    entityType: 'user',
    entityId: createdStaff.id,
    afterState: createdStaff,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return createdStaff;
}

export async function setStaffActiveStatus({ id, isActive, user, reqMeta }) {
  const currentRes = await query('SELECT id, email, role, is_active FROM users WHERE id = $1', [id]);
  if (currentRes.rows.length === 0) {
    throw new NotFoundError(`User with ID '${id}' not found.`);
  }

  const res = await query(
    `
    UPDATE users
    SET is_active = $2, updated_at = clock_timestamp()
    WHERE id = $1
    RETURNING id, email, role, full_name, phone, is_active, updated_at;
    `,
    [id, Boolean(isActive)]
  );

  const updatedStaff = res.rows[0];

  await auditService.logAction({
    actorId: user.id,
    actorRole: user.role,
    action: 'UPDATE_STAFF_STATUS',
    entityType: 'user',
    entityId: id,
    beforeState: currentRes.rows[0],
    afterState: updatedStaff,
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    requestId: reqMeta.requestId,
  });

  return updatedStaff;
}

export async function listStaff({ role = null, page = 1, pageSize = 20, q = '' }) {
  const offset = (page - 1) * pageSize;
  let sql = 'SELECT id, email, role, full_name, phone, is_active, created_at FROM users WHERE 1=1';
  const values = [];

  if (role) {
    values.push(role);
    sql += ` AND role = $${values.length}`;
  }

  if (q && q.trim()) {
    values.push(`%${q.trim()}%`);
    sql += ` AND (full_name ILIKE $${values.length} OR email ILIKE $${values.length})`;
  }

  const countRes = await query(
    sql.replace(
      'SELECT id, email, role, full_name, phone, is_active, created_at',
      'SELECT COUNT(*) as total'
    ),
    values
  );
  const total = parseInt(countRes.rows[0].total, 10);

  values.push(pageSize);
  sql += ` ORDER BY created_at DESC LIMIT $${values.length}`;
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

export default {
  getDepartments,
  createDepartment,
  listDoctors,
  createDoctorWithUser,
  createScheduleRule,
  getDoctorSchedules,
  createStaffUser,
  setStaffActiveStatus,
  listStaff,
};
