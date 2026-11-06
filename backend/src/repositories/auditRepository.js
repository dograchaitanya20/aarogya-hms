import { query } from '../config/db.js';

export async function createAuditEntry({
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
  const sql = `
    INSERT INTO audit_log (
      actor_id, actor_role, action, entity_type, entity_id,
      before_state, after_state, ip_address, user_agent, request_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, ts, actor_id, actor_role, action, entity_type, entity_id, created_at;
  `;

  const values = [
    actorId,
    actorRole,
    action,
    entityType,
    String(entityId),
    beforeState ? JSON.stringify(beforeState) : null,
    afterState ? JSON.stringify(afterState) : null,
    ipAddress,
    userAgent,
    requestId,
  ];

  const result = await query(sql, values);
  return result.rows[0];
}

export async function getAuditLogs({ limit = 50, offset = 0, entityType = null, entityId = null }) {
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const values = [];

  if (entityType) {
    values.push(entityType);
    sql += ` AND entity_type = $${values.length}`;
  }

  if (entityId) {
    values.push(entityId);
    sql += ` AND entity_id = $${values.length}`;
  }

  values.push(limit);
  sql += ` ORDER BY ts DESC LIMIT $${values.length}`;

  values.push(offset);
  sql += ` OFFSET $${values.length}`;

  const result = await query(sql, values);
  return result.rows;
}

export default {
  createAuditEntry,
  getAuditLogs,
};
