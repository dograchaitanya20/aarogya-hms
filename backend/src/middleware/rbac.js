import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';
import auditService from '../services/auditService.js';
import userRepository from '../repositories/userRepository.js';

export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      if (!allowedRoles.includes(req.user.role)) {
        // Log permission denial to audit log
        await auditService.logPermissionDenied({
          actorId: req.user.id,
          actorRole: req.user.role,
          resource: req.baseUrl + req.path,
          action: req.method,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          requestId: req.id,
          details: {
            requiredRoles: allowedRoles,
            userRole: req.user.role,
          },
        });

        throw new ForbiddenError(
          `Access denied. Role '${req.user.role}' does not have permission to access this resource.`
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Helper middleware to enforce clinician -> patient relationship
 */
export function requireClinicianPatientAccess(patientIdParam = 'patientId') {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      // If user is clinician, verify relationship
      if (req.user.role === 'clinician') {
        const patientId = req.params[patientIdParam] || req.body[patientIdParam] || req.query[patientIdParam];
        if (!patientId) {
          throw new ForbiddenError('Patient identifier required for access check');
        }

        const hasAccess = await userRepository.checkClinicianPatientAccess(req.user.id, patientId);
        if (!hasAccess) {
          await auditService.logPermissionDenied({
            actorId: req.user.id,
            actorRole: req.user.role,
            resource: 'patient_record',
            action: req.method,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            requestId: req.id,
            details: {
              patientId,
              reason: 'Clinician does not have an appointment or encounter with this patient',
            },
          });

          throw new ForbiddenError('Clinicians may only access records for patients they have treated or have an appointment with.');
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export default {
  requireRole,
  requireClinicianPatientAccess,
};
