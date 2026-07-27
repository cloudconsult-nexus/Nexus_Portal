import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';

const router = Router();
router.use(requireAuth, requireRole('customer_admin'));

const querySchema = z.object({
  entityType: z.string().optional(),
  action: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get('/', async (req, res) => {
  const q = querySchema.parse(req.query);
  const conditions = [];
  const values = [];
  let i = 1;

  if (q.entityType) { conditions.push(`entity_type = $${i++}`); values.push(q.entityType); }
  if (q.action) { conditions.push(`action = $${i++}`); values.push(q.action); }
  // Never trust q.organizationId directly — resolveScopedOrgIds reads the
  // same query param internally, but only honors it within the caller's
  // own subtree (Customer Admin) or as an optional "view as" filter
  // (Global Admin). Previously this was an unchecked client-supplied
  // filter, so a Customer Admin who simply omitted it saw every
  // Customer's audit trail.
  const scopedIds = await resolveScopedOrgIds(req);
  if (scopedIds !== null) { conditions.push(`organization_id = ANY($${i++})`); values.push(scopedIds); }
  if (q.from) { conditions.push(`created_at >= $${i++}`); values.push(q.from); }
  if (q.to) { conditions.push(`created_at <= $${i++}`); values.push(q.to); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(q.limit);

  const { rows } = await pool.query(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${i}`,
    values
  );
  res.json({ auditLogs: rows });
});

export default router;
