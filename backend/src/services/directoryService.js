import departmentRepository from '../repositories/departmentRepository.js';
import auditService from './auditService.js';

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

export default {
  getDepartments,
  createDepartment,
};
