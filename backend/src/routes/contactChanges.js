import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';

const router = Router();
router.use(requireAuth, auditContext);

const ALLOWED_FIELDS = ['name', 'email', 'primary_phone', 'sms_phone', 'secondary_phone', 'department'];

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM contact_change_requests ORDER BY created_at DESC');
  res.json({ contactChanges: rows });
});

router.post('/', requireAuth, async (req, res) => {
  const input = z
    .object({ personId: z.string().uuid(), proposedChanges: z.record(z.string()) })
    .parse(req.body);

  const invalidFields = Object.keys(input.proposedChanges).filter((f) => !ALLOWED_FIELDS.includes(f));
  if (invalidFields.length > 0) {
    return res.status(400).json({ error: `Cannot request changes to: ${invalidFields.join(', ')}` });
  }

  const { rows } = await pool.query(
    `INSERT INTO contact_change_requests (person_id, requested_by, proposed_changes) VALUES ($1, $2, $3) RETURNING *`,
    [input.personId, req.user.id, JSON.stringify(input.proposedChanges)]
  );
  await req.logAudit({ action: 'create', entityType: 'contact_change_request', entityId: rows[0].id });
  res.status(201).json({ contactChange: rows[0] });
});

router.post('/:id/approve', requireRole('customer_admin'), async (req, res) => {
  const { rows: reqRows } = await pool.query('SELECT * FROM contact_change_requests WHERE id = $1', [req.params.id]);
  const changeRequest = reqRows[0];
  if (!changeRequest) return res.status(404).json({ error: 'Not found' });
  if (changeRequest.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });

  const setClauses = Object.keys(changeRequest.proposed_changes).map((field, i) => `${field} = $${i + 2}`);
  const values = Object.values(changeRequest.proposed_changes);
  await pool.query(
    `UPDATE people SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1`,
    [changeRequest.person_id, ...values]
  );

  const { rows } = await pool.query(
    `UPDATE contact_change_requests SET status = 'approved', reviewed_by = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [req.user.id, req.params.id]
  );
  await req.logAudit({ action: 'update', entityType: 'contact_change_request', entityId: req.params.id, newValues: { status: 'approved' } });
  res.json({ contactChange: rows[0] });
});

router.post('/:id/reject', requireRole('customer_admin'), async (req, res) => {
  const { reviewerNotes } = z.object({ reviewerNotes: z.string().optional() }).parse(req.body);
  const { rows } = await pool.query(
    `UPDATE contact_change_requests SET status = 'rejected', reviewed_by = $1, reviewer_notes = $2, updated_at = now()
     WHERE id = $3 AND status = 'pending' RETURNING *`,
    [req.user.id, reviewerNotes || null, req.params.id]
  );
  if (!rows[0]) return res.status(400).json({ error: 'Request already reviewed' });
  res.json({ contactChange: rows[0] });
});

export default router;
