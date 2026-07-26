import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScheduleAccess } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';

const router = Router();
router.use(requireAuth, auditContext);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM shift_swap_requests ORDER BY created_at DESC');
  res.json({ shiftSwaps: rows });
});

const createSchema = z.object({
  assignmentId: z.string().uuid(),
  swapRole: z.enum(['primary', 'secondary', 'tertiary']),
  targetPersonId: z.string().uuid(),
  reason: z.string().optional(),
});

router.post('/', async (req, res) => {
  const input = createSchema.parse(req.body);
  const { rows } = await pool.query(
    `INSERT INTO shift_swap_requests (assignment_id, swap_role, requested_by, target_person_id, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.assignmentId, input.swapRole, req.user.id, input.targetPersonId, input.reason || null]
  );
  await req.logAudit({ action: 'create', entityType: 'shift_swap_request', entityId: rows[0].id });
  res.status(201).json({ shiftSwap: rows[0] });
});

// Stage 1: the target person accepts the swap.
router.post('/:id/accept', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE shift_swap_requests SET status = 'pending_admin', updated_at = now()
     WHERE id = $1 AND status = 'pending_target' RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(400).json({ error: 'Swap request is not awaiting target acceptance' });
  res.json({ shiftSwap: rows[0] });
});

// Stage 2: an admin/scheduler approves — this is what actually mutates the
// assignment, swapping requested_by's role slot for target_person_id.
router.post('/:id/approve', requireScheduleAccess, async (req, res) => {
  const { rows: swapRows } = await pool.query('SELECT * FROM shift_swap_requests WHERE id = $1', [req.params.id]);
  const swap = swapRows[0];
  if (!swap) return res.status(404).json({ error: 'Not found' });
  if (swap.status !== 'pending_admin') return res.status(400).json({ error: 'Swap request is not awaiting admin approval' });

  const column = { primary: 'primary_person_id', secondary: 'secondary_person_id', tertiary: 'tertiary_person_id' }[swap.swap_role];
  await pool.query(`UPDATE assignments SET ${column} = $1, updated_at = now() WHERE id = $2`, [
    swap.target_person_id,
    swap.assignment_id,
  ]);

  const { rows } = await pool.query(
    `UPDATE shift_swap_requests SET status = 'approved', reviewed_by = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [req.user.id, req.params.id]
  );
  await req.logAudit({ action: 'update', entityType: 'shift_swap_request', entityId: req.params.id, newValues: { status: 'approved' } });
  res.json({ shiftSwap: rows[0] });
});

router.post('/:id/reject', requireScheduleAccess, async (req, res) => {
  const { adminNotes } = z.object({ adminNotes: z.string().optional() }).parse(req.body);
  const { rows } = await pool.query(
    `UPDATE shift_swap_requests SET status = 'rejected', reviewed_by = $1, admin_notes = $2, updated_at = now()
     WHERE id = $3 AND status IN ('pending_target', 'pending_admin') RETURNING *`,
    [req.user.id, adminNotes || null, req.params.id]
  );
  if (!rows[0]) return res.status(400).json({ error: 'Swap request is not in a rejectable state' });
  res.json({ shiftSwap: rows[0] });
});

router.post('/:id/cancel', async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE shift_swap_requests SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND requested_by = $2 AND status IN ('pending_target', 'pending_admin') RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(400).json({ error: 'Cannot cancel this swap request' });
  res.json({ shiftSwap: rows[0] });
});

export default router;
