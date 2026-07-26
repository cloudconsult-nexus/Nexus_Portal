import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { assetKey, uploadAsset } from '../lib/storage.js';
import { createInvitation } from '../lib/invitations.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.use(requireAuth, auditContext);

router.get('/', async (req, res) => {
  const scopeOrgId = req.user.role === 'global_admin' ? null : req.user.organizationId;
  const { rows } = await pool.query(
    `SELECT id, organization_id, name, email, primary_phone, sms_phone, secondary_phone,
            department, job_title, role, can_edit_schedule, is_active, photo_url, login_enabled
     FROM people
     WHERE is_deleted = false AND ($1::uuid IS NULL OR organization_id = $1)
     ORDER BY name`,
    [scopeOrgId]
  );
  res.json({ people: rows });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const person = rows[0];
  if (!person) return res.status(404).json({ error: 'Not found' });
  if (!scopeAllows(req, person.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { password_hash, mfa_secret, ...safe } = person;
  res.json({ person: safe });
});

const createSchema = z.object({
  name: z.string().min(1),
  organizationId: z.string().uuid(),
  email: z.string().email().optional(),
  primaryPhone: z.string().optional(),
  smsPhone: z.string().optional(),
  secondaryPhone: z.string().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  role: z.enum(['global_admin', 'customer_admin', 'user']).default('user'),
  canEditSchedule: z.boolean().default(false),
  sendInvite: z.boolean().optional(),
});

router.post('/', requireRole('customer_admin'), async (req, res) => {
  const input = createSchema.parse(req.body);
  if (!scopeAllows(req, input.organizationId)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { rows } = await pool.query(
    `INSERT INTO people (organization_id, name, email, primary_phone, sms_phone, secondary_phone, department, job_title, role, can_edit_schedule)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [input.organizationId, input.name, input.email || null, input.primaryPhone || null, input.smsPhone || null,
     input.secondaryPhone || null, input.department || null, input.jobTitle || null, input.role, input.canEditSchedule]
  );
  const person = rows[0];

  if (input.sendInvite && input.email) {
    await createInvitation({
      personId: person.id,
      organizationId: input.organizationId,
      email: input.email,
      name: input.name,
      role: input.role,
      invitedById: req.user.id,
    });
  }

  await req.logAudit({ action: 'create', entityType: 'person', entityId: person.id, entityName: person.name, organizationId: input.organizationId });
  const { password_hash, mfa_secret, ...safe } = person;
  res.status(201).json({ person: safe });
});

router.put('/:id', requireRole('customer_admin'), async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!scopeAllows(req, existing.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });

  const fields = ['name', 'email', 'primary_phone', 'sms_phone', 'secondary_phone', 'department', 'job_title', 'is_active', 'can_edit_schedule'];
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
  // Role changes are audited distinctly (role_change) since they're a
  // privilege escalation/de-escalation, not a routine field edit.
  if (req.body.role !== undefined && req.body.role !== existing.role) {
    updates.push(`role = $${i++}`);
    values.push(req.body.role);
  }
  if (updates.length === 0) return res.json({ person: existing });

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE people SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );

  if (req.body.role !== undefined && req.body.role !== existing.role) {
    await req.logAudit({
      action: 'role_change',
      entityType: 'person',
      entityId: req.params.id,
      entityName: rows[0].name,
      oldValues: { role: existing.role },
      newValues: { role: rows[0].role },
    });
  }
  await req.logAudit({ action: 'update', entityType: 'person', entityId: req.params.id, entityName: rows[0].name, oldValues: existing, newValues: rows[0] });

  const { password_hash, mfa_secret, ...safe } = rows[0];
  res.json({ person: safe });
});

router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  const isSelf = req.user.id === req.params.id;
  const isAdminTier = req.user.role === 'global_admin' || req.user.role === 'customer_admin';
  if (!isSelf && !isAdminTier) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const key = assetKey('person-photos', req.file.originalname);
  const url = await uploadAsset(key, req.file.buffer, req.file.mimetype);
  await pool.query('UPDATE people SET photo_url = $1, updated_at = now() WHERE id = $2', [url, req.params.id]);
  res.json({ photoUrl: url });
});

router.delete('/:id', requireRole('customer_admin'), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE people SET is_deleted = true, deleted_at = now(), deleted_by = $1
     WHERE id = $2 AND is_deleted = false RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await req.logAudit({ action: 'delete', entityType: 'person', entityId: req.params.id, entityName: rows[0].name });
  res.status(204).end();
});

function scopeAllows(req, organizationId) {
  if (req.user.role === 'global_admin') return true;
  return req.user.organizationId === organizationId;
}

export default router;
