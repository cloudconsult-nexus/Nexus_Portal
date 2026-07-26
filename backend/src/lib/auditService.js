import pool from '../db/pool.js';

// Append-only — no route ever issues UPDATE/DELETE against audit_logs
// (enforced at the app layer per migrations/001_init.sql's closing comment).
export async function logAction({
  userId,
  userEmail,
  action,
  entityType,
  entityId = null,
  entityName = null,
  organizationId = null,
  oldValues = null,
  newValues = null,
}) {
  await pool.query(
    `INSERT INTO audit_logs
       (user_id, user_email, action, entity_type, entity_id, entity_name,
        organization_id, old_values, new_values)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      userEmail,
      action,
      entityType,
      entityId,
      entityName,
      organizationId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ]
  );
}
