import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { ROLE_RANK } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { parseCsv } from '../lib/importHelpers.js';
import { getTemplateHeader } from '../lib/importTemplates.js';
import { validateBatch, commitBatch, rollbackBatch } from '../lib/importEngine.js';
import { validateScheduleBatch, commitScheduleBatch } from '../lib/scheduleImportService.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(requireAuth, auditContext);

// The frontend's org selects use '' for "— None —"/"All" (a plain HTML
// <select> has no null option value) — coerce that to null before it ever
// reaches zod's .uuid() check, otherwise an unset filter throws instead of
// validating as "not set".
function emptyToNull(v) {
  return v === '' ? null : v;
}

// Organization (Customer) imports create new Customer *records* — same
// Global-Admin-only rule as POST /organizations (routes/organizations.js),
// not just "admin tier." Person/calendar imports are structural
// (Customer Admin+, scoped via resolveScopedOrgIds below); assignment
// imports are schedule mutations, following the same requireScheduleAccess
// rule as routes/assignments.js (Customer Admin+, or a User individually
// granted schedule-edit authority).
function canImportEntityType(user, entityType) {
  if (entityType === 'organization') return user.role === 'global_admin';
  const isAdminTier = (ROLE_RANK[user.role] ?? -1) >= ROLE_RANK.customer_admin;
  if (entityType === 'assignment') return isAdminTier || user.canEditSchedule;
  return isAdminTier;
}

router.get('/template/:entityType', (req, res) => {
  const columns = getTemplateHeader(req.params.entityType);
  res.type('text/csv').send(columns.join(',') + '\n');
});

router.post('/validate', upload.single('file'), async (req, res) => {
  const { entityType, organizationId, action } = z
    .object({
      entityType: z.enum(['organization', 'person', 'calendar', 'assignment']),
      organizationId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
      action: z.enum(['create', 'update', 'delete']).default('create'),
    })
    .parse(req.body);

  if (!canImportEntityType(req.user, entityType)) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const rows = parseCsv(req.file.buffer);
  const scopedIds = await resolveScopedOrgIds(req);

  const result =
    entityType === 'assignment'
      ? await validateScheduleBatch(action, organizationId, rows, req.user.id, scopedIds)
      : await validateBatch(entityType, organizationId, rows, req.user.id, scopedIds);

  await pool.query(`UPDATE import_batches SET status = 'validated' WHERE id = $1 AND status = 'validated'`, [result.batchId]);
  res.json(result);
});

router.get('/:batchId', async (req, res) => {
  const { rows: batchRows } = await pool.query('SELECT * FROM import_batches WHERE id = $1', [req.params.batchId]);
  if (!batchRows[0]) return res.status(404).json({ error: 'Not found' });
  const { rows: batchRowDetails } = await pool.query(
    'SELECT * FROM import_batch_rows WHERE batch_id = $1 ORDER BY row_number',
    [req.params.batchId]
  );
  res.json({ batch: batchRows[0], rows: batchRowDetails });
});

router.post('/:batchId/commit', async (req, res) => {
  const { rows } = await pool.query('SELECT entity_type FROM import_batches WHERE id = $1', [req.params.batchId]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  if (!canImportEntityType(req.user, rows[0].entity_type)) return res.status(403).json({ error: 'Insufficient permissions' });

  if (rows[0].entity_type === 'assignment') {
    await commitScheduleBatch(req.params.batchId);
  } else {
    await commitBatch(req.params.batchId);
  }
  await req.logAudit({ action: 'create', entityType: 'import_batch', entityId: req.params.batchId, newValues: { committed: true } });
  res.status(204).end();
});

router.post('/:batchId/rollback', async (req, res) => {
  const { rows: batchRows } = await pool.query('SELECT entity_type FROM import_batches WHERE id = $1', [req.params.batchId]);
  if (!batchRows[0]) return res.status(404).json({ error: 'Not found' });
  if (!canImportEntityType(req.user, batchRows[0].entity_type)) return res.status(403).json({ error: 'Insufficient permissions' });

  await rollbackBatch(req.params.batchId);
  await req.logAudit({ action: 'delete', entityType: 'import_batch', entityId: req.params.batchId, newValues: { rolledBack: true } });
  res.status(204).end();
});

export default router;
