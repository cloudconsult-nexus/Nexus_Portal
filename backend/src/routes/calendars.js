import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';

const router = Router();
router.use(requireAuth, auditContext);

router.get('/', async (req, res) => {
  const scopedIds = await resolveScopedOrgIds(req);
  const { rows } = await pool.query(
    `SELECT * FROM calendars WHERE ($1::uuid[] IS NULL OR organization_id = ANY($1)) ORDER BY name`,
    [scopedIds]
  );
  res.json({ calendars: rows });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM calendars WHERE id = $1', [req.params.id]);
  const calendar = rows[0];
  if (!calendar) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, calendar.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  res.json({ calendar });
});

const upsertSchema = z.object({
  name: z.string().min(1),
  organizationId: z.string().uuid(),
  description: z.string().optional(),
  coverageType: z.enum(['24x7', 'business_hours', 'after_hours', 'custom']).default('24x7'),
});

router.post('/', requireRole('customer_admin'), async (req, res) => {
  const input = upsertSchema.parse(req.body);
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, input.organizationId)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { rows } = await pool.query(
    `INSERT INTO calendars (organization_id, name, description, coverage_type) VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.organizationId, input.name, input.description || null, input.coverageType]
  );
  await req.logAudit({ action: 'create', entityType: 'calendar', entityId: rows[0].id, entityName: rows[0].name, organizationId: input.organizationId });
  res.status(201).json({ calendar: rows[0] });
});

router.put('/:id', requireRole('customer_admin'), async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM calendars WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, existing.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { rows } = await pool.query(
    `UPDATE calendars SET name = $1, description = $2, coverage_type = $3, updated_at = now() WHERE id = $4 RETURNING *`,
    [req.body.name ?? existing.name, req.body.description ?? existing.description, req.body.coverageType ?? existing.coverage_type, req.params.id]
  );
  await req.logAudit({ action: 'update', entityType: 'calendar', entityId: req.params.id, entityName: rows[0].name, oldValues: existing, newValues: rows[0] });
  res.json({ calendar: rows[0] });
});

router.delete('/:id', requireRole('customer_admin'), async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM calendars WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, existing.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });

  await pool.query('DELETE FROM calendars WHERE id = $1', [req.params.id]);
  await req.logAudit({ action: 'delete', entityType: 'calendar', entityId: req.params.id, entityName: existing.name });
  res.status(204).end();
});

function scopeAllows(scopedIds, organizationId) {
  return scopedIds === null || scopedIds.includes(organizationId);
}

export default router;
