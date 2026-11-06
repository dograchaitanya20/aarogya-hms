import auditRepository from '../repositories/auditRepository.js';

export async function listAuditLogs(req, res, next) {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const entityType = req.query.entityType || null;
    const entityId = req.query.entityId || null;

    const logs = await auditRepository.getAuditLogs({ limit, offset, entityType, entityId });
    res.status(200).json({ data: logs });
  } catch (err) {
    next(err);
  }
}

export default {
  listAuditLogs,
};
