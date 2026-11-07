import auditRepository from '../repositories/auditRepository.js';
import logger from '../config/logger.js';

export async function logAction(
  {
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
  },
  client = null
) {
  try {
    return await auditRepository.createAuditEntry(
      {
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
      },
      client
    );
  } catch (err) {
    logger.error({ err, action, entityType, entityId }, 'Failed to write audit log entry');
    // If inside a transaction client, re-throw to guarantee transactional rollback!
    if (client) {
      throw err;
    }
  }
}

export async function logAuthEvent({
  action,
  email,
  actorId = null,
  actorRole = null,
  ipAddress,
  userAgent,
  requestId,
  details = {},
}) {
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

export async function logPermissionDenied({
  actorId = null,
  actorRole = null,
  resource,
  action,
  ipAddress = null,
  userAgent = null,
  requestId = null,
  details = {},
}) {
  return logAction({
    actorId,
    actorRole,
    action: 'PERMISSION_DENIED',
    entityType: 'authorization',
    entityId: resource,
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
