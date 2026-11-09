import { z } from 'zod';
import directoryService from '../services/directoryService.js';
import { parsePagination } from '../utils/pagination.js';

const createDepartmentSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20).toUpperCase(),
  description: z.string().optional(),
});

const updateDepartmentSchema = z.object({
  name: z.string().min(2).optional(),
  code: z.string().min(2).max(20).toUpperCase().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
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

const updateDoctorSchema = z.object({
  specialization: z.string().min(2).optional(),
  consultationFeePaise: z.number().int().nonnegative().optional(),
  roomNumber: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

const createScheduleSchema = z.object({
  doctorId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  slotDurationMinutes: z.number().int().positive(),
});

const updateScheduleSchema = z.object({
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  slotDurationMinutes: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
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

export async function updateDepartment(req, res, next) {
  try {
    const body = updateDepartmentSchema.parse(req.body);
    const updated = await directoryService.updateDepartment(req.params.id, body, {
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

export async function deleteDepartment(req, res, next) {
  try {
    const deleted = await directoryService.deleteDepartment(req.params.id, {
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(200).json({ message: 'Department deactivated successfully', data: deleted });
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

export async function getDoctorById(req, res, next) {
  try {
    const doctor = await directoryService.getDoctorById(req.params.id);
    res.status(200).json({ data: doctor });
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

export async function updateDoctor(req, res, next) {
  try {
    const body = updateDoctorSchema.parse(req.body);
    const updated = await directoryService.updateDoctor(req.params.id, body, {
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

export async function deleteDoctor(req, res, next) {
  try {
    const deleted = await directoryService.deleteDoctor(req.params.id, {
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(200).json({ message: 'Doctor deactivated successfully', data: deleted });
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

export async function updateSchedule(req, res, next) {
  try {
    const body = updateScheduleSchema.parse(req.body);
    const updated = await directoryService.updateSchedule(req.params.id, body, {
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

export async function deleteSchedule(req, res, next) {
  try {
    const deleted = await directoryService.deleteSchedule(req.params.id, {
      user: req.user,
      reqMeta: {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.id,
      },
    });
    res.status(200).json({ message: 'Schedule deactivated successfully', data: deleted });
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
    const { page, pageSize } = parsePagination(req.query, 20);

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
  updateDepartment,
  deleteDepartment,
  listDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getDoctorSchedules,
  listStaff,
  createStaff,
  setStaffStatus,
};
