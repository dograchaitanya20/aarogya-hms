import { query } from '../config/db.js';

export async function createAuditEntry(
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
  const runner = client || { query };
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

  const result = await runner.query(sql, values);
  return result.rows[0];
}

export async function getAuditLogs({
  page = 1,
  pageSize = 50,
  entityType = null,
  entityId = null,
  actorId = null,
  action = null,
  from = null,
  to = null,
}) {
  const values = [];
  let where = ' WHERE 1=1';
  const add = (clause, value) => {
    values.push(value);
    where += ` AND ${clause.replace('?', `$${values.length}`)}`;
  };

  if (entityType) add('a.entity_type = ?', entityType);
  if (entityId) add('a.entity_id = ?', entityId);
  if (actorId) add('a.actor_id = ?', actorId);
  if (action) add('a.action = ?', action);
  if (from) add('a.ts >= ?', from);
  if (to) add('a.ts < ?', to);

  const base = ` FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id${where}`;
  const countRes = await query(`SELECT COUNT(*) AS total${base}`, values);
  const total = parseInt(countRes.rows[0].total, 10);

  values.push(pageSize, (page - 1) * pageSize);
  const result = await query(
    `SELECT a.*, u.full_name AS actor_name, u.email AS actor_email${base}
     ORDER BY a.ts DESC, a.id
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { data: result.rows, page, pageSize, total };
}

export default {
  createAuditEntry,
  getAuditLogs,
};
