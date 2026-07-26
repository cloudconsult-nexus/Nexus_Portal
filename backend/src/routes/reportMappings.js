import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';

// Admin management of the report catalog (migrations/008_report_mappings.sql:
// "platform-wide catalog... not org-scoped like branding"). The read-only
// consumption side (list visible reports, get an embed URL) lives in
// routes/reports.js instead.
const router = Router();
router.use(requireAuth, requireRole('global_admin'), auditContext);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM report_mappings ORDER BY sort_order');
  res.json({ reportMappings: rows });
});

const upsertSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  embedUrl: z.string().url(),
  ssoEnabled: z.boolean().default(false),
  ssoSharedSecret: z.string().optional(),
  tokenParam: z.string().default('token'),
  visibleToRoles: z.array(z.enum(['global_admin', 'customer_admin', 'user'])).min(1),
  sortOrder: z.number().int().default(0),
});

router.post('/', async (req, res) => {
  const input = upsertSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO report_mappings (name, description, embed_url, sso_enabled, sso_shared_secret, token_param, visible_to_roles, sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [input.name, input.description || null, input.embedUrl, input.ssoEnabled, input.ssoSharedSecret || null, input.tokenParam, input.visibleToRoles, input.sortOrder, req.user.id]
  );
  await req.logAudit({ action: 'create', entityType: 'report_mapping', entityId: rows[0].id, entityName: rows[0].name });
  res.status(201).json({ reportMapping: rows[0] });
});

router.put('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM report_mappings WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const fields = ['name', 'description', 'embed_url', 'sso_enabled', 'sso_shared_secret', 'token_param', 'visible_to_roles', 'sort_order', 'is_active'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const field of fields) {
    const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (req.body[camel] !== undefined) {
      updates.push(`${field} = $${i++}`);
      values.push(req.body[camel]);
    }
  }
  if (updates.length === 0) return res.json({ reportMapping: existing });

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE report_mappings SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );
  await req.logAudit({ action: 'update', entityType: 'report_mapping', entityId: req.params.id, entityName: rows[0].name, oldValues: existing, newValues: rows[0] });
  res.json({ reportMapping: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('DELETE FROM report_mappings WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await req.logAudit({ action: 'delete', entityType: 'report_mapping', entityId: req.params.id, entityName: rows[0].name });
  res.status(204).end();
});

export default router;
