import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { getEffectiveBranding } from '../lib/branding.js';
import { assetKey, uploadAsset, resolveAssetUrl } from '../lib/storage.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';
import { isValidTimeZone } from '../lib/calendarService.js';

// Customers (flat — no more hierarchy levels/parent nesting; see
// migrations/013_tas_customer_model.sql). Kept on the `organizations`
// table/route name internally per the Phase 5.1 decision — only the
// user-facing labels say "Customer" now, not the DB/API vocabulary.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.use(requireAuth, auditContext);

// Logo/favicon URLs are signed fresh on every read (see lib/storage.js) —
// the bucket itself has no public-read grant.
async function withResolvedBranding(org) {
  if (!org) return org;
  return {
    ...org,
    logo_url: await resolveAssetUrl(org.logo_url),
    favicon_url: await resolveAssetUrl(org.favicon_url),
  };
}

// Global Admin sees every Customer (or, with ?organizationId=, that
// Customer + its descendants as a "view as" filter on their already-full
// access); a Customer Admin/User sees their own Customer + every
// descendant in the optional parent_id nesting — see lib/orgScope.js.
router.get('/', async (req, res) => {
  const scopedIds = await resolveScopedOrgIds(req);
  const { rows } = await pool.query(
    `SELECT * FROM organizations WHERE is_deleted = false AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY name`,
    [scopedIds]
  );
  res.json({ organizations: await Promise.all(rows.map(withResolvedBranding)) });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
  const org = rows[0];
  if (!org) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, org.id)) return res.status(403).json({ error: 'Insufficient permissions' });
  res.json({ organization: await withResolvedBranding(org) });
});

router.get('/:id/effective-branding', async (req, res) => {
  res.json(await getEffectiveBranding(req.params.id));
});

// Customer records themselves are Global-Admin-only (the TAS creates and
// manages its Customers) — a Customer Admin administers their own
// Customer's Users/contacts/schedule, not the Customer record or other
// Customers. This is a real tightening from the old org_admin-level access.
const createSchema = z.object({
  name: z.string().min(1),
  accountNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});

router.post('/', requireRole('global_admin'), async (req, res) => {
  const input = createSchema.parse(req.body);

  const { rows } = await pool.query(
    `INSERT INTO organizations (name, account_number, phone, email) VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.name, input.accountNumber || null, input.phone || null, input.email || null]
  );
  const org = rows[0];

  await req.logAudit({ action: 'create', entityType: 'organization', entityId: org.id, entityName: org.name, newValues: org });
  res.status(201).json({ organization: await withResolvedBranding(org) });
});

router.put('/:id', requireRole('global_admin'), async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Setting a parent must not create a cycle (including the trivial
  // self-parent case) — walk up from the proposed new parent and reject if
  // the Customer being edited shows up in that ancestor chain.
  if (req.body.parentId !== undefined && req.body.parentId !== null) {
    const { rows: cycleRows } = await pool.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id, parent_id FROM organizations WHERE id = $1
         UNION ALL
         SELECT o.id, o.parent_id FROM organizations o JOIN ancestors a ON o.id = a.parent_id
       )
       SELECT 1 FROM ancestors WHERE id = $2 LIMIT 1`,
      [req.body.parentId, req.params.id]
    );
    if (cycleRows[0]) return res.status(400).json({ error: 'A Customer cannot be its own ancestor' });
  }

  // Validated up front (unlike the other fields in the generic loop below)
  // because an invalid value here doesn't just save wrong — it throws at
  // query time in lib/calendarService.js#getOnCallAt (NCC's on-call lookup)
  // the next time anyone queries this Customer's on-call status.
  if (req.body.timezone !== undefined && !isValidTimeZone(req.body.timezone)) {
    return res.status(400).json({ error: 'Invalid timezone' });
  }

  const fields = [
    'name', 'account_number', 'phone', 'email', 'address', 'website', 'primary_contact',
    'call_messages_url', 'logo_url', 'primary_color', 'accent_color', 'name_override',
    'tagline', 'favicon_url', 'description', 'message_html', 'contact_edit_requires_approval',
    'parent_id', 'timezone',
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
  if (updates.length === 0) return res.json({ organization: await withResolvedBranding(existing) });

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE organizations SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );

  await req.logAudit({
    action: 'update',
    entityType: 'organization',
    entityId: req.params.id,
    entityName: rows[0].name,
    oldValues: existing,
    newValues: rows[0],
  });
  res.json({ organization: await withResolvedBranding(rows[0]) });
});

// Branding uploads hang off the same :id/... shape as everything else here
// — mirrors routes/people.js's :id/photo pattern.
router.post('/:id/logo', requireRole('global_admin'), upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const key = assetKey('org-logos', req.file.originalname);
  const url = await uploadAsset(key, req.file.buffer, req.file.mimetype);
  await pool.query('UPDATE organizations SET logo_url = $1, updated_at = now() WHERE id = $2', [url, req.params.id]);
  res.json({ logoUrl: await resolveAssetUrl(url) });
});

router.post('/:id/favicon', requireRole('global_admin'), upload.single('favicon'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const key = assetKey('org-favicons', req.file.originalname);
  const url = await uploadAsset(key, req.file.buffer, req.file.mimetype);
  await pool.query('UPDATE organizations SET favicon_url = $1, updated_at = now() WHERE id = $2', [url, req.params.id]);
  res.json({ faviconUrl: await resolveAssetUrl(url) });
});

router.delete('/:id', requireRole('global_admin'), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE organizations SET is_deleted = true, deleted_at = now(), deleted_by = $1
     WHERE id = $2 RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await req.logAudit({ action: 'delete', entityType: 'organization', entityId: req.params.id, entityName: rows[0].name });
  res.status(204).end();
});

router.post('/:id/restore', requireRole('global_admin'), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE organizations SET is_deleted = false, deleted_at = NULL, deleted_by = NULL
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await req.logAudit({ action: 'restore', entityType: 'organization', entityId: req.params.id, entityName: rows[0].name });
  res.status(204).end();
});

function scopeAllows(scopedIds, orgId) {
  return scopedIds === null || scopedIds.includes(orgId);
}

export default router;
