import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { auditContext } from '../middleware/audit.js';
import { searchMessages, isConfigured } from '../lib/thrio.js';

// NCC (Thrio) integration — see RUNBOOK.md's "NCC Integration" section.
// NCC remains the source of truth for messages; "removing" one here only
// hides it from this portal's view (ncc_message_removals), it's never
// deleted from NCC — Thrio's history API doesn't even expose a delete call.
const router = Router();
router.use(requireAuth, auditContext);

router.get('/', async (req, res) => {
  if (!isConfigured()) {
    return res.json({ configured: false });
  }

  const { rangeType } = z.object({ rangeType: z.string().optional() }).parse(req.query);
  const messages = await searchMessages({ rangeType: rangeType || 'last30days' });

  const { rows: removedRows } = await pool.query('SELECT workitem_id FROM ncc_message_removals');
  const removedIds = new Set(removedRows.map((r) => r.workitem_id));

  res.json({ configured: true, messages: messages.filter((m) => !removedIds.has(m.id)) });
});

const removeSchema = z.object({ workitemId: z.string().min(1) });

router.post('/:workitemId/remove', async (req, res) => {
  const { workitemId } = removeSchema.parse(req.params);
  await pool.query(
    `INSERT INTO ncc_message_removals (workitem_id, removed_by) VALUES ($1, $2)
     ON CONFLICT (workitem_id) DO NOTHING`,
    [workitemId, req.user.id]
  );
  // entityId is skipped, not workitemId — audit_logs.entity_id is UUID-typed
  // (every other entity in this app has a UUID pk); Thrio's workitem ids
  // (e.g. "CAa2ff644a...") aren't UUIDs, so it goes in entityName instead.
  await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: workitemId, newValues: { removedFromPortal: true } });
  res.status(204).end();
});

router.post('/:workitemId/restore', async (req, res) => {
  const { workitemId } = removeSchema.parse(req.params);
  await pool.query('DELETE FROM ncc_message_removals WHERE workitem_id = $1', [workitemId]);
  await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: workitemId, newValues: { removedFromPortal: false } });
  res.status(204).end();
});

export default router;
