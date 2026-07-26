import pool from '../db/pool.js';
import { validateRowShape } from './importHelpers.js';

// Assignment (schedule) imports, separate from importEngine.js because they
// support update/delete alongside create (migrations/011), with old_values
// snapshotted for the preview diff and for accurate rollback.
export async function validateScheduleBatch(action, organizationId, rows, userId) {
  const batch = await pool.query(
    `INSERT INTO import_batches (entity_type, organization_id, total_rows, created_by, action)
     VALUES ('assignment', $1, $2, $3, $4) RETURNING id`,
    [organizationId, rows.length, userId, action]
  );
  const batchId = batch.rows[0].id;

  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const errors = validateRowShape('assignment', row);
    let oldValues = null;
    let existingAssignment = null;

    if (action !== 'create') {
      existingAssignment = await findExistingAssignment(row);
      if (!existingAssignment) errors.push('No matching existing assignment found for update/delete');
      else oldValues = existingAssignment;
    }

    const status = errors.length > 0 ? 'invalid' : 'valid';
    if (status === 'valid') validCount++;
    else invalidCount++;

    await pool.query(
      `INSERT INTO import_batch_rows (batch_id, row_number, raw_data, status, errors, old_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [batchId, i + 1, JSON.stringify(row), status, JSON.stringify(errors), oldValues ? JSON.stringify(oldValues) : null]
    );
  }

  await pool.query(`UPDATE import_batches SET valid_rows = $1, invalid_rows = $2 WHERE id = $3`, [
    validCount,
    invalidCount,
    batchId,
  ]);

  return { batchId, totalRows: rows.length, validRows: validCount, invalidRows: invalidCount };
}

async function findExistingAssignment(row) {
  const { rows } = await pool.query(
    `SELECT a.* FROM assignments a
     JOIN calendars c ON c.id = a.calendar_id
     WHERE c.name = $1 AND a.date = $2 AND a.start_time = $3`,
    [row.calendar_name, row.date, row.start_time]
  );
  return rows[0] || null;
}

async function resolvePersonId(email) {
  if (!email) return null;
  const { rows } = await pool.query('SELECT id FROM people WHERE lower(email) = lower($1)', [email]);
  return rows[0]?.id || null;
}

async function resolveCalendarId(name) {
  const { rows } = await pool.query('SELECT id FROM calendars WHERE name = $1', [name]);
  if (!rows[0]) throw new Error(`No calendar named ${name}`);
  return rows[0].id;
}

export async function commitScheduleBatch(batchId) {
  const { rows: batchRows } = await pool.query('SELECT * FROM import_batches WHERE id = $1', [batchId]);
  const batch = batchRows[0];
  if (!batch) throw new Error('Import batch not found');

  const { rows: pendingRows } = await pool.query(
    `SELECT * FROM import_batch_rows WHERE batch_id = $1 AND status = 'valid' ORDER BY row_number`,
    [batchId]
  );

  for (const row of pendingRows) {
    const data = row.raw_data;
    try {
      if (batch.action === 'create') {
        const id = await createAssignment(data);
        await pool.query(`UPDATE import_batch_rows SET status = 'created', created_entity_id = $1 WHERE id = $2`, [
          id,
          row.id,
        ]);
      } else if (batch.action === 'update') {
        await updateAssignment(row.old_values.id, data);
        await pool.query(`UPDATE import_batch_rows SET status = 'updated' WHERE id = $1`, [row.id]);
      } else if (batch.action === 'delete') {
        await pool.query('DELETE FROM assignments WHERE id = $1', [row.old_values.id]);
        await pool.query(`UPDATE import_batch_rows SET status = 'deleted' WHERE id = $1`, [row.id]);
      }
    } catch (err) {
      await pool.query(`UPDATE import_batch_rows SET status = 'failed', errors = $1 WHERE id = $2`, [
        JSON.stringify([err.message]),
        row.id,
      ]);
    }
  }

  await pool.query(`UPDATE import_batches SET status = 'committed', committed_at = now() WHERE id = $1`, [batchId]);
}

async function createAssignment(data) {
  const calendarId = await resolveCalendarId(data.calendar_name);
  const [primary, secondary, tertiary] = await Promise.all([
    resolvePersonId(data.primary_person_email),
    resolvePersonId(data.secondary_person_email),
    resolvePersonId(data.tertiary_person_email),
  ]);
  const { rows } = await pool.query(
    `INSERT INTO assignments (calendar_id, date, start_time, end_time, mode, primary_person_id, secondary_person_id, tertiary_person_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [calendarId, data.date, data.start_time, data.end_time, data.mode || 'escalation', primary, secondary, tertiary]
  );
  return rows[0].id;
}

async function updateAssignment(assignmentId, data) {
  const [primary, secondary, tertiary] = await Promise.all([
    resolvePersonId(data.primary_person_email),
    resolvePersonId(data.secondary_person_email),
    resolvePersonId(data.tertiary_person_email),
  ]);
  await pool.query(
    `UPDATE assignments
     SET start_time = $1, end_time = $2, primary_person_id = $3, secondary_person_id = $4, tertiary_person_id = $5, updated_at = now()
     WHERE id = $6`,
    [data.start_time, data.end_time, primary, secondary, tertiary, assignmentId]
  );
}
