import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { createInvitation, revokeInvitation } from '../lib/invitations.js';

const router = Router();
router.use(requireAuth, requireRole('customer_admin'), auditContext);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM invitations ORDER BY created_at DESC');
  res.json({ invitations: rows });
});

router.post('/:id/resend', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM invitations WHERE id = $1 AND status = $2', [req.params.id, 'pending']);
  const existing = rows[0];
  if (!existing) return res.status(400).json({ error: 'Invitation is not pending' });

  await revokeInvitation(existing.id);
  await createInvitation({
    personId: existing.person_id,
    organizationId: existing.organization_id,
    email: existing.email,
    name: existing.name,
    role: existing.role,
    invitedById: req.user.id,
  });
  res.status(204).end();
});

router.post('/:id/revoke', async (req, res) => {
  await revokeInvitation(req.params.id);
  await req.logAudit({ action: 'update', entityType: 'invitation', entityId: req.params.id, newValues: { status: 'revoked' } });
  res.status(204).end();
});

export default router;
