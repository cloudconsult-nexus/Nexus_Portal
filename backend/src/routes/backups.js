import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import * as cloudSql from '../lib/cloudSql.js';

// Global-Admin-only: on-demand backup + restore-to-new-instance against the
// live Cloud SQL instance, via the Cloud SQL Admin API (backend/src/lib/cloudSql.js)
// — not the app's own Postgres connection. See RUNBOOK.md's "Database
// backup & restore" section for the equivalent CLI flow and the reasoning
// behind never restoring in place.
const router = Router();
router.use(requireAuth, requireRole('global_admin'), auditContext);

function unavailable(res) {
  return res.status(501).json({ error: 'Backups are only available when deployed on Cloud Run (no Cloud SQL instance in this environment).' });
}

router.get('/', async (req, res) => {
  if (!cloudSql.isConfigured()) return unavailable(res);
  const backups = await cloudSql.listBackups();
  res.json({ backups });
});

const createSchema = z.object({ description: z.string().max(200).optional() });

router.post('/', async (req, res) => {
  if (!cloudSql.isConfigured()) return unavailable(res);
  const input = createSchema.parse(req.body);
  const operation = await cloudSql.createBackup({ description: input.description });
  await req.logAudit({ action: 'create', entityType: 'db_backup', entityName: input.description || 'On-demand backup' });
  res.status(202).json({ operation });
});

const restoreSchema = z.object({
  // Cloud SQL instance name rules: lowercase letters, digits, hyphens.
  destinationInstanceName: z.string().min(1).max(63).regex(/^[a-z][a-z0-9-]*$/, 'Lowercase letters, digits, and hyphens only, starting with a letter'),
});

router.post('/:id/restore', async (req, res) => {
  if (!cloudSql.isConfigured()) return unavailable(res);
  const input = restoreSchema.parse(req.body);
  const operation = await cloudSql.restoreToNewInstance({ backupId: req.params.id, destinationInstanceName: input.destinationInstanceName });
  await req.logAudit({
    action: 'restore',
    entityType: 'db_backup',
    entityId: req.params.id,
    entityName: input.destinationInstanceName,
    newValues: { destinationInstanceName: input.destinationInstanceName },
  });
  res.status(202).json({ operation });
});

export default router;
