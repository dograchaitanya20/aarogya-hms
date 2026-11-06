import auditRepository from '../repositories/auditRepository.js';
import logger from '../config/logger.js';

export async function logAction({
  actorId = null,
  actorRole = null,
  action,
  entityType,
  entityId,
  beforeState = null,
  afterState = null,
  ipAddress = null,
  userAgent = null,
  requestId = null,
}) {
  try {
    return await auditRepository.createAuditEntry({
      actorId,
      actorRole,
      action,
      entityType,
      entityId,
      beforeState,
      afterState,
      ipAddress,
      userAgent,
      requestId,
    });
  } catch (err) {
    logger.error({ err, action, entityType, entityId }, 'Failed to write audit log entry');
    // Note: Do not throw here unless required, or allow silent failure if DB allows, but DB trigger ensures immutability
  }
}

export async function logAuthEvent({ action, email, actorId = null, actorRole = null, ipAddress, userAgent, requestId, details = {} }) {
  return logAction({
    actorId,
    actorRole,
    action,
    entityType: 'auth',
    entityId: email || actorId || 'unknown',
    afterState: details,
    ipAddress,
    userAgent,
    requestId,
  });
}

export async function logPermissionDenied({ actorId = null, actorRole = null, resource, action, ipAddress, userAgent, requestId, details = {} }) {
  return logAction({
    actorId,
    actorRole,
    action: 'PERMISSION_DENIED',
    entityType: resource,
    entityId: details.entityId || 'resource',
    afterState: { attemptedAction: action, ...details },
    ipAddress,
    userAgent,
    requestId,
  });
}

export default {
  logAction,
  logAuthEvent,
  logPermissionDenied,
};
