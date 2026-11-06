import { z } from 'zod';
import directoryService from '../services/directoryService.js';

const createDepartmentSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20).toUpperCase(),
  description: z.string().optional(),
});

const createDoctorSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().min(5),
  departmentId: z.string().uuid(),
  specialization: z.string().min(2),
  consultationFeePaise: z.number().int().nonnegative(),
  roomNumber: z.string().optional(),
});

const createScheduleSchema = z.object({
  doctorId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  slotDurationMinutes: z.number().int().positive(),
});

const createStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().min(5),
  role: z.enum(['front_desk', 'admin']),
});

export async function listDepartments(req, res, next) {
  try {
    const departments = await directoryService.getDepartments();
    res.status(200).json({ data: departments });
  } catch (err) {
    next(err);
  }
}

export async function createDepartment(req, res, next) {
  try {
    const body = createDepartmentSchema.parse(req.body);
    const department = await directoryService.createDepartment({
      ...body,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(201).json({ data: department });
  } catch (err) {
    next(err);
  }
}

export async function listDoctors(req, res, next) {
  try {
    const { departmentId, q } = req.query;
    const isActive = req.query.isActive === undefined ? true : req.query.isActive === 'true';
    const doctors = await directoryService.listDoctors({ departmentId, q, isActive });
    res.status(200).json({ data: doctors });
  } catch (err) {
    next(err);
  }
}

export async function createDoctor(req, res, next) {
  try {
    const body = createDoctorSchema.parse(req.body);
    const doctor = await directoryService.createDoctorWithUser({
      ...body,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(201).json({ data: doctor });
  } catch (err) {
    next(err);
  }
}

export async function createSchedule(req, res, next) {
  try {
    const body = createScheduleSchema.parse(req.body);
    const schedule = await directoryService.createScheduleRule({
      ...body,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(201).json({ data: schedule });
  } catch (err) {
    next(err);
  }
}

export async function getDoctorSchedules(req, res, next) {
  try {
    const schedules = await directoryService.getDoctorSchedules(req.params.doctorId);
    res.status(200).json({ data: schedules });
  } catch (err) {
    next(err);
  }
}

export async function listStaff(req, res, next) {
  try {
    const { role, q } = req.query;
    const page = parseInt(req.query.page || '1', 10);
    const pageSize = parseInt(req.query.pageSize || '20', 10);

    const result = await directoryService.listStaff({ role, q, page, pageSize });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function createStaff(req, res, next) {
  try {
    const body = createStaffSchema.parse(req.body);
    const staff = await directoryService.createStaffUser({
      ...body,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(201).json({ data: staff });
  } catch (err) {
    next(err);
  }
}

export async function setStaffStatus(req, res, next) {
  try {
    const { isActive } = req.body;
    const updated = await directoryService.setStaffActiveStatus({
      id: req.params.id,
      isActive,
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(200).json({ data: updated });
  } catch (err) {
    next(err);
  }
}

export default {
  listDepartments,
  createDepartment,
  listDoctors,
  createDoctor,
  createSchedule,
  getDoctorSchedules,
  listStaff,
  createStaff,
  setStaffStatus,
};
