import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import {
  getNccStatus,
  upsertOrganizationCredentials,
  clearOrganizationCredentials,
  upsertTasCredentials,
  clearTasCredentials,
  setMessageLookbackDays,
} from '../services/ncc-client/config.js';

// Credential management for the NCC integration (Phase 5.2 fetch layer).
// API-only, no frontend yet — Customer Messages/Secure Messaging UI is a
// later, collaboratively-designed phase (CLAUDE.md/build brief), and this
// is purely operational configuration, not something end users touch.
// Global Admin only, same tier as tas-settings and NCC_API_KEY-adjacent
// config elsewhere in the app.
//
// GET never returns a decrypted username/password — only whether NCC is
// configured and non-secret bookkeeping (location, last auth result). The
// audit log entries below record THAT a credential was changed, never the
// credential value itself.
const router = Router();
router.use(requireAuth, requireRole('global_admin'), auditContext);

const credsSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

router.get('/:orgId', async (req, res) => {
  res.json(await getNccStatus(req.params.orgId));
});

router.put('/:orgId', async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM organizations WHERE id = $1 AND is_deleted = false', [req.params.orgId]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  const { username } = credsSchema.parse(req.body);
  await upsertOrganizationCredentials(req.params.orgId, req.body);
  await req.logAudit({ action: 'update', entityType: 'ncc_org_config', entityId: req.params.orgId, newValues: { username, passwordSet: true } });
  res.json(await getNccStatus(req.params.orgId));
});

router.delete('/:orgId', async (req, res) => {
  await clearOrganizationCredentials(req.params.orgId);
  await req.logAudit({ action: 'delete', entityType: 'ncc_org_config', entityId: req.params.orgId });
  res.status(204).end();
});

// Phase E1 of the NCC dev/release plan: per-Customer message-fetch lookback
// window. Kept Global-Admin-only/API-only, same tier as the credential
// management above — no dedicated UI yet, same as the rest of this file.
const lookbackSchema = z.object({ days: z.number().int().min(1).max(3650) });

router.put('/:orgId/message-lookback', async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM organizations WHERE id = $1 AND is_deleted = false', [req.params.orgId]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  const { days } = lookbackSchema.parse(req.body);
  await setMessageLookbackDays(req.params.orgId, days);
  await req.logAudit({ action: 'update', entityType: 'ncc_org_config', entityId: req.params.orgId, newValues: { messageLookbackDays: days } });
  res.json(await getNccStatus(req.params.orgId));
});

// TAS-wide default tenant — the common case per migrations/018's fallback
// design (Customer override -> this -> not configured).
router.put('/tas/default', async (req, res) => {
  const { username } = credsSchema.parse(req.body);
  await upsertTasCredentials(req.body);
  await req.logAudit({ action: 'update', entityType: 'ncc_tas_config', newValues: { username, passwordSet: true } });
  res.json({ configured: true });
});

router.delete('/tas/default', async (req, res) => {
  await clearTasCredentials();
  await req.logAudit({ action: 'delete', entityType: 'ncc_tas_config' });
  res.status(204).end();
});

export default router;
