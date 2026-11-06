import { z } from 'zod';
import directoryService from '../services/directoryService.js';

const createDepartmentSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(20).toUpperCase(),
  description: z.string().optional(),
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

export default {
  listDepartments,
  createDepartment,
};
