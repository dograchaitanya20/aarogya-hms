import auditRepository from '../repositories/auditRepository.js';
import { parsePagination } from '../utils/pagination.js';
import { ValidationError } from '../errors/AppError.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function listAuditLogs(req, res, next) {
  try {
    // "limit" is accepted as a legacy alias for pageSize
    const { page, pageSize } = parsePagination({
      page: req.query.page,
      pageSize: req.query.pageSize || req.query.limit,
    }, 50);
    const { entityType, entityId, actorId, action, from, to } = req.query;

    for (const [name, value] of [['from', from], ['to', to]]) {
      if (value && !DATE_RE.test(value)) {
        throw new ValidationError(`${name} must be a date in YYYY-MM-DD format.`);
      }
    }
    // "to" is inclusive of the whole day
    const toExclusive = to ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString() : null;

    const result = await auditRepository.getAuditLogs({
      page,
      pageSize,
      entityType: entityType || null,
      entityId: entityId || null,
      actorId: actorId || null,
      action: action || null,
      from: from ? `${from}T00:00:00Z` : null,
      to: toExclusive,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export default {
  listAuditLogs,
};
