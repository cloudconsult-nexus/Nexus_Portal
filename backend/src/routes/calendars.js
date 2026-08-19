import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';

const router = Router();
router.use(requireAuth, auditContext);

// Same "must be assignable to this org" rule assignments.js applies to
// primary/secondary/tertiary/default on a shift — a calendar's own standing
// default (lib/calendarService.js#getOnCallAt's full-coverage-gap fallback)
// gets the same check so it can't point at a person with no relationship to
// this Customer.
async function isAssignableToOrg(personId, organizationId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM people
     WHERE id = $1
       AND (organization_id = $2 OR EXISTS (
         SELECT 1 FROM person_organizations po WHERE po.person_id = people.id AND po.organization_id = $2
       ))`,
    [personId, organizationId]
  );
  return !!rows[0];
}

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
  defaultPersonId: z.string().uuid().nullable().optional(),
});

router.post('/', requireRole('customer_admin'), async (req, res) => {
  const input = upsertSchema.parse(req.body);
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, input.organizationId)) return res.status(403).json({ error: 'Insufficient permissions' });
  if (input.defaultPersonId && !(await isAssignableToOrg(input.defaultPersonId, input.organizationId))) {
    return res.status(400).json({ error: "Default contact must be assignable to this calendar's organization" });
  }

  const { rows } = await pool.query(
    `INSERT INTO calendars (organization_id, name, description, coverage_type, default_person_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.organizationId, input.name, input.description || null, input.coverageType, input.defaultPersonId || null]
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

  const defaultPersonId = req.body.defaultPersonId === '' ? null : req.body.defaultPersonId;
  if (defaultPersonId && !(await isAssignableToOrg(defaultPersonId, existing.organization_id))) {
    return res.status(400).json({ error: "Default contact must be assignable to this calendar's organization" });
  }

  const { rows } = await pool.query(
    `UPDATE calendars SET name = $1, description = $2, coverage_type = $3, default_person_id = $4, updated_at = now() WHERE id = $5 RETURNING *`,
    [
      req.body.name ?? existing.name,
      req.body.description ?? existing.description,
      req.body.coverageType ?? existing.coverage_type,
      defaultPersonId !== undefined ? defaultPersonId : existing.default_person_id,
      req.params.id,
    ]
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
