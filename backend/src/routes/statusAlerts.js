import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';

const router = Router();

// Public — this is the banner display endpoint the frontend polls
// unauthenticated (matches migrations/010's "cheap indexed lookup" intent).
router.get('/active', async (req, res) => {
  const { organizationId } = z.object({ organizationId: z.string().uuid().optional() }).parse(req.query);
  const { rows } = await pool.query(
    `SELECT id, message, alert_type FROM status_alerts
     WHERE is_currently_active = true AND (organization_id IS NULL OR organization_id = $1)`,
    [organizationId || null]
  );
  res.json({ activeAlerts: rows });
});

router.use(requireAuth, requireRole('global_admin'), auditContext);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM status_alerts ORDER BY created_at DESC');
  res.json({ statusAlerts: rows });
});

const upsertSchema = z.object({
  message: z.string().min(1).max(120),
  organizationId: z.string().uuid().nullable().optional(),
  alertType: z.enum(['one_time', 'recurring']),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  recurrenceDays: z.array(z.number().int().min(0).max(6)).optional(),
  recurrenceStartTime: z.string().optional(),
  recurrenceEndTime: z.string().optional(),
  recurrenceStartDate: z.string().optional(),
  recurrenceEndDate: z.string().optional(),
  isEnabled: z.boolean().default(true),
});

router.post('/', async (req, res) => {
  const input = upsertSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO status_alerts
       (message, organization_id, alert_type, start_at, end_at, recurrence_days,
        recurrence_start_time, recurrence_end_time, recurrence_start_date, recurrence_end_date,
        is_enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      input.message, input.organizationId || null, input.alertType, input.startAt || null, input.endAt || null,
      input.recurrenceDays || null, input.recurrenceStartTime || null, input.recurrenceEndTime || null,
      input.recurrenceStartDate || null, input.recurrenceEndDate || null, input.isEnabled, req.user.id,
    ]
  );
  await req.logAudit({ action: 'create', entityType: 'status_alert', entityId: rows[0].id, entityName: rows[0].message });
  res.status(201).json({ statusAlert: rows[0] });
});

router.put('/:id', async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM status_alerts WHERE id = $1', [req.params.id]);
  if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });

  const fields = [
    'message', 'is_enabled', 'start_at', 'end_at', 'recurrence_days',
    'recurrence_start_time', 'recurrence_end_time', 'recurrence_start_date', 'recurrence_end_date',
  ];
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
  if (updates.length === 0) return res.json({ statusAlert: existingRows[0] });

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE status_alerts SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );
  await req.logAudit({ action: 'update', entityType: 'status_alert', entityId: req.params.id, entityName: rows[0].message, oldValues: existingRows[0], newValues: rows[0] });
  res.json({ statusAlert: rows[0] });
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('DELETE FROM status_alerts WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await req.logAudit({ action: 'delete', entityType: 'status_alert', entityId: req.params.id, entityName: rows[0].message });
  res.status(204).end();
});

export default router;
