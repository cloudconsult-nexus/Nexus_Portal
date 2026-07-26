import pool from '../db/pool.js';
import { validateRowShape } from './importHelpers.js';

// Bulk import for organization/person/calendar. Assignment imports go
// through scheduleImportService.js instead — they need update/delete
// actions (migrations/011_schedule_import_actions.sql), not just create.
export async function validateBatch(entityType, organizationId, rows, userId) {
  const batch = await pool.query(
    `INSERT INTO import_batches (entity_type, organization_id, total_rows, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [entityType, organizationId, rows.length, userId]
  );
  const batchId = batch.rows[0].id;

  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const errors = await validateRow(entityType, row);
    const status = errors.length > 0 ? 'invalid' : 'valid';
    if (status === 'valid') validCount++;
    else invalidCount++;

    await pool.query(
      `INSERT INTO import_batch_rows (batch_id, row_number, raw_data, status, errors)
       VALUES ($1, $2, $3, $4, $5)`,
      [batchId, i + 1, JSON.stringify(row), status, JSON.stringify(errors)]
    );
  }

  await pool.query(`UPDATE import_batches SET valid_rows = $1, invalid_rows = $2 WHERE id = $3`, [
    validCount,
    invalidCount,
    batchId,
  ]);

  return { batchId, totalRows: rows.length, validRows: validCount, invalidRows: invalidCount };
}

async function validateRow(entityType, row) {
  const errors = validateRowShape(entityType, row);
  if (errors.length > 0) return errors;

  if (entityType !== 'organization' && row.organization_account_number) {
    const { rows } = await pool.query('SELECT id FROM organizations WHERE account_number = $1', [
      row.organization_account_number,
    ]);
    if (rows.length === 0) errors.push(`No organization found with account number ${row.organization_account_number}`);
  }

  return errors;
}

export async function commitBatch(batchId) {
  const { rows: batchRows } = await pool.query('SELECT * FROM import_batches WHERE id = $1', [batchId]);
  const batch = batchRows[0];
  if (!batch) throw new Error('Import batch not found');
  if (batch.status !== 'validated') throw new Error(`Batch already ${batch.status}`);

  const { rows: pendingRows } = await pool.query(
    `SELECT * FROM import_batch_rows WHERE batch_id = $1 AND status = 'valid' ORDER BY row_number`,
    [batchId]
  );

  for (const row of pendingRows) {
    const data = row.raw_data;
    let createdId;
    try {
      createdId = await createEntity(batch.entity_type, data);
      await pool.query(`UPDATE import_batch_rows SET status = 'created', created_entity_id = $1 WHERE id = $2`, [
        createdId,
        row.id,
      ]);
    } catch (err) {
      await pool.query(`UPDATE import_batch_rows SET status = 'failed', errors = $1 WHERE id = $2`, [
        JSON.stringify([err.message]),
        row.id,
      ]);
    }
  }

  await pool.query(`UPDATE import_batches SET status = 'committed', committed_at = now() WHERE id = $1`, [batchId]);
}

async function createEntity(entityType, data) {
  if (entityType === 'organization') {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, account_number, phone, email)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [data.name, data.account_number || null, data.phone || null, data.email || null]
    );
    return rows[0].id;
  }

  if (entityType === 'person') {
    const org = await lookupOrgId(data.organization_account_number);
    const { rows } = await pool.query(
      `INSERT INTO people (organization_id, name, email, primary_phone, sms_phone, role, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [org, data.name, data.email || null, data.primary_phone || null, data.sms_phone || null, data.role, data.department || null]
    );
    return rows[0].id;
  }

  if (entityType === 'calendar') {
    const org = await lookupOrgId(data.organization_account_number);
    const { rows } = await pool.query(
      `INSERT INTO calendars (organization_id, name, description, coverage_type)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, data.name, data.description || null, data.coverage_type || '24x7']
    );
    return rows[0].id;
  }

  throw new Error(`createEntity: unsupported entity type ${entityType}`);
}

async function lookupOrgId(accountNumber) {
  const { rows } = await pool.query('SELECT id FROM organizations WHERE account_number = $1', [accountNumber]);
  if (!rows[0]) throw new Error(`No organization with account number ${accountNumber}`);
  return rows[0].id;
}

export async function rollbackBatch(batchId) {
  const { rows: batchRows } = await pool.query('SELECT * FROM import_batches WHERE id = $1', [batchId]);
  const batch = batchRows[0];
  if (!batch) throw new Error('Import batch not found');
  if (batch.status !== 'committed') throw new Error(`Only committed batches can be rolled back, got ${batch.status}`);

  const { rows: createdRows } = await pool.query(
    `SELECT created_entity_id FROM import_batch_rows WHERE batch_id = $1 AND status = 'created'`,
    [batchId]
  );

  const table = { organization: 'organizations', person: 'people', calendar: 'calendars' }[batch.entity_type];
  for (const row of createdRows) {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [row.created_entity_id]);
  }

  await pool.query(`UPDATE import_batches SET status = 'rolled_back', rolled_back_at = now() WHERE id = $1`, [
    batchId,
  ]);
}
