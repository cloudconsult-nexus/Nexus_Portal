import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { assetKey, uploadAsset, resolveAssetUrl } from '../lib/storage.js';
import { createInvitation, revokePendingForPerson } from '../lib/invitations.js';
import { resolveScopedOrgIds, getHierarchyTreeIds } from '../lib/orgScope.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.use(requireAuth, auditContext);

// photo_url is signed fresh on every read (see lib/storage.js) — the
// bucket itself has no public-read grant.
async function withResolvedPhoto(person) {
  if (!person) return person;
  return { ...person, photo_url: await resolveAssetUrl(person.photo_url) };
}

// Email only has to be unique among people who can actually log in — see
// migrations/017_email_unique_only_when_login_enabled.sql. Checked up front
// so a conflict comes back as a clear 409 instead of a raw constraint-
// violation 500; excludePersonId lets an update ignore its own row.
async function findEmailConflict(email, excludePersonId = null) {
  const { rows } = await pool.query(
    `SELECT id, name FROM people
     WHERE lower(email) = lower($1) AND is_deleted = false AND login_enabled = true
       AND ($2::uuid IS NULL OR id != $2)`,
    [email, excludePersonId]
  );
  return rows[0] || null;
}

// Backstop for the race between the check above and the write below (two
// concurrent requests claiming the same email) — the unique index is the
// real guarantee, this just keeps its violation from surfacing as a raw 500.
function isEmailConflictError(err) {
  return err.code === '23505' && err.constraint === 'idx_people_email_unique';
}

const PEOPLE_COLUMNS = `id, organization_id, name, email, primary_phone, sms_phone, secondary_phone,
       department, job_title, role, can_edit_schedule, is_active, photo_url, login_enabled,
       last_active_at,
       (SELECT COUNT(*) FROM person_organizations po WHERE po.person_id = people.id)::int AS additional_org_count`;

router.get('/', async (req, res) => {
  const { assignableToOrganizationId } = z.object({ assignableToOrganizationId: z.string().uuid().optional() }).parse(req.query);

  // Full scheduling reach: who's eligible for a calendar in this specific
  // organization (primary or additionally linked) — independent of the
  // requester's own management subtree, since the calendar itself already
  // establishes the need-to-know (see routes/assignments.js's identical
  // membership check at write time).
  if (assignableToOrganizationId) {
    const { rows } = await pool.query(
      `SELECT ${PEOPLE_COLUMNS}
       FROM people
       WHERE is_deleted = false
         AND (organization_id = $1 OR EXISTS (
           SELECT 1 FROM person_organizations po WHERE po.person_id = people.id AND po.organization_id = $1
         ))
       ORDER BY name`,
      [assignableToOrganizationId]
    );
    return res.json({ people: await Promise.all(rows.map(withResolvedPhoto)) });
  }

  const scopedIds = await resolveScopedOrgIds(req);
  const { rows } = await pool.query(
    `SELECT ${PEOPLE_COLUMNS}
     FROM people
     WHERE is_deleted = false AND ($1::uuid[] IS NULL OR organization_id = ANY($1))
     ORDER BY name`,
    [scopedIds]
  );
  res.json({ people: await Promise.all(rows.map(withResolvedPhoto)) });
});

router.get('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const person = rows[0];
  if (!person) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, person.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { password_hash, mfa_secret, ...safe } = person;
  res.json({ person: await withResolvedPhoto(safe) });
});

const createSchema = z.object({
  name: z.string().min(1),
  // A Global Admin sits above every organization (TAS-wide access, see
  // lib/orgScope.js's resolveScopedOrgIds — it ignores the caller's own
  // organization_id entirely), so they're the one role that doesn't need
  // one. migrations/002_unify_people_rbac.sql already dropped the DB's NOT
  // NULL constraint on people.organization_id for exactly this case.
  organizationId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  // Same empty-string-isn't-undefined trap as organizationId above — an
  // admin leaving Email blank (e.g. a Global Admin with no email yet)
  // otherwise fails .email()'s format check instead of just being absent.
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  primaryPhone: z.string().optional(),
  smsPhone: z.string().optional(),
  secondaryPhone: z.string().optional(),
  department: z.string().optional(),
  jobTitle: z.string().optional(),
  role: z.enum(['global_admin', 'customer_admin', 'user']).default('user'),
  canEditSchedule: z.boolean().default(false),
  sendInvite: z.boolean().optional(),
  // Global-Admin-only alternative to the email invite: activates the
  // account immediately with this password instead of waiting on
  // invite delivery/acceptance.
  password: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(8).optional()),
});

router.post('/', requireRole('customer_admin'), async (req, res) => {
  const input = createSchema.parse(req.body);
  if (input.role !== 'global_admin' && !input.organizationId) {
    return res.status(400).json({ error: 'Organization is required.' });
  }
  const scopedIds = await resolveScopedOrgIds(req);
  if (input.organizationId && !scopeAllows(scopedIds, input.organizationId)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  if (input.password && req.user.role !== 'global_admin') {
    return res.status(403).json({ error: 'Only Global Admins can set a password directly.' });
  }
  if (input.role === 'global_admin' && req.user.role !== 'global_admin') {
    return res.status(403).json({ error: 'Only Global Admins can create other Global Admins.' });
  }

  // A directly-set password activates the account immediately (login_enabled
  // = true below), so it has to clear the same email-uniqueness bar as any
  // other active account. An invite-only person stays login_enabled = false
  // until accepted (see routes/auth.js's /accept-invite), so no check is
  // needed here for that path — see findEmailConflict's docstring.
  if (input.email && input.password) {
    const conflict = await findEmailConflict(input.email);
    if (conflict) return res.status(409).json({ error: `That email is already in use by ${conflict.name}.` });
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;

  let person;
  try {
    const { rows } = await pool.query(
      `INSERT INTO people (organization_id, name, email, primary_phone, sms_phone, secondary_phone, department, job_title, role, can_edit_schedule, password_hash, login_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [input.organizationId || null, input.name, input.email || null, input.primaryPhone || null, input.smsPhone || null,
       input.secondaryPhone || null, input.department || null, input.jobTitle || null, input.role, input.canEditSchedule,
       passwordHash, !!input.password]
    );
    person = rows[0];
  } catch (err) {
    if (isEmailConflictError(err)) return res.status(409).json({ error: 'That email is already in use by another active user.' });
    throw err;
  }

  // A directly-set password already activates the account — skip the
  // invite entirely rather than sending a now-redundant one.
  let emailDelivered = null;
  if (!input.password && input.sendInvite && input.email) {
    ({ emailDelivered } = await createInvitation({
      personId: person.id,
      organizationId: input.organizationId || null,
      email: input.email,
      name: input.name,
      role: input.role,
      invitedById: req.user.id,
    }));
  }

  await req.logAudit({
    action: 'create', entityType: 'person', entityId: person.id, entityName: person.name, organizationId: input.organizationId || null,
    newValues: { activationMethod: input.password ? 'admin_set_password' : (input.sendInvite ? 'email_invite' : 'none'), emailDelivered },
  });
  const { password_hash, mfa_secret, ...safe } = person;
  res.status(201).json({ person: await withResolvedPhoto(safe), emailDelivered });
});

router.put('/:id', requireRole('customer_admin'), async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, existing.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });

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
    if (req.body.role === 'global_admin' && req.user.role !== 'global_admin') {
      return res.status(403).json({ error: 'Only Global Admins can create other Global Admins.' });
    }
    updates.push(`role = $${i++}`);
    values.push(req.body.role);
  }
  if (updates.length === 0) {
    const { password_hash, mfa_secret, ...safe } = existing;
    return res.json({ person: await withResolvedPhoto(safe) });
  }

  // Only a login_enabled person can actually hit the login-by-email lookup
  // (see findEmailConflict's docstring), so a still-pending person is free
  // to share an email — only check when this update would leave them (or
  // already has them) able to log in.
  if (req.body.email && req.body.email.toLowerCase() !== (existing.email || '').toLowerCase() && existing.login_enabled) {
    const conflict = await findEmailConflict(req.body.email, req.params.id);
    if (conflict) return res.status(409).json({ error: `That email is already in use by ${conflict.name}.` });
  }

  values.push(req.params.id);
  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE people SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
      values
    ));
  } catch (err) {
    if (isEmailConflictError(err)) return res.status(409).json({ error: 'That email is already in use by another active user.' });
    throw err;
  }

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
  res.json({ person: await withResolvedPhoto(safe) });
});

const setPasswordSchema = z.object({ password: z.string().min(8) });

// Global-Admin-only: set/reset a person's password directly, activating
// (or reactivating) their account without an email invite/reset round
// trip. Also clears any lockout and revokes a still-pending invite, so a
// stale invite link can't later overwrite the password an admin just set.
router.post('/:id/set-password', requireRole('global_admin'), async (req, res) => {
  const { password } = setPasswordSchema.parse(req.body);
  const { rows: existingRows } = await pool.query('SELECT id, name FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE people SET password_hash = $1, login_enabled = true, is_active = true,
       failed_login_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE id = $2`,
    [passwordHash, req.params.id]
  );
  await revokePendingForPerson(req.params.id);

  await req.logAudit({ action: 'set_password', entityType: 'person', entityId: req.params.id, entityName: existing.name });
  res.status(204).end();
});

// Additional (non-primary) organizations a person can also be scheduled
// under — "full scheduling reach" (see routes/assignments.js's org-
// membership check). Restricted to the same nested hierarchy tree as the
// person's primary org (organizations.parent_id), and for non-Global-
// Admins, further restricted to the caller's own subtree.
router.get('/:id/organizations', async (req, res) => {
  const { rows: personRows } = await pool.query('SELECT organization_id FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const person = personRows[0];
  if (!person) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, person.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { rows } = await pool.query(
    `SELECT po.id, po.organization_id, o.name, o.account_number
     FROM person_organizations po
     JOIN organizations o ON o.id = po.organization_id
     WHERE po.person_id = $1
     ORDER BY o.name`,
    [req.params.id]
  );
  res.json({ organizations: rows });
});

// Orgs the caller could actually add for this person: within the person's
// hierarchy tree, not already the primary or an existing link, and (for
// non-Global-Admins) within the caller's own subtree too — pre-filtered so
// the frontend picker can only ever offer valid choices.
router.get('/:id/organizations/candidates', async (req, res) => {
  const { rows: personRows } = await pool.query('SELECT organization_id FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const person = personRows[0];
  if (!person) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, person.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });

  const treeIds = await getHierarchyTreeIds(person.organization_id);
  const { rows: existingLinks } = await pool.query('SELECT organization_id FROM person_organizations WHERE person_id = $1', [req.params.id]);
  const excluded = new Set([person.organization_id, ...existingLinks.map((r) => r.organization_id)]);
  const candidateIds = treeIds.filter((id) => !excluded.has(id) && (scopedIds === null || scopedIds.includes(id)));
  if (candidateIds.length === 0) return res.json({ organizations: [] });

  const { rows } = await pool.query(
    `SELECT id, name, account_number FROM organizations WHERE id = ANY($1) AND is_deleted = false ORDER BY name`,
    [candidateIds]
  );
  res.json({ organizations: rows });
});

// Field is deliberately NOT named `organizationId` in the request body —
// resolveScopedOrgIds(req) treats any req.body.organizationId as a "view
// as" drill-down request for the CALLER's own scope, which would collide
// with this route's unrelated meaning (the org being linked) and silently
// narrow a Global Admin's own scope to just that org, rejecting the person
// as "out of scope" even though they see everyone.
const addOrgSchema = z.object({ targetOrganizationId: z.string().uuid() });

router.post('/:id/organizations', requireRole('customer_admin'), async (req, res) => {
  const { targetOrganizationId } = addOrgSchema.parse(req.body);
  const { rows: personRows } = await pool.query('SELECT id, name, organization_id FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const person = personRows[0];
  if (!person) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, person.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!scopeAllows(scopedIds, targetOrganizationId)) return res.status(403).json({ error: 'Insufficient permissions' });

  if (targetOrganizationId === person.organization_id) {
    return res.status(400).json({ error: "That is already this person's primary organization." });
  }
  const treeIds = await getHierarchyTreeIds(person.organization_id);
  if (!treeIds.includes(targetOrganizationId)) {
    return res.status(400).json({ error: "Organization must be within the person's own hierarchy tree." });
  }

  const { rows } = await pool.query(
    `INSERT INTO person_organizations (person_id, organization_id, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (person_id, organization_id) DO NOTHING
     RETURNING *`,
    [req.params.id, targetOrganizationId, req.user.id]
  );
  const { rows: orgRows } = await pool.query('SELECT name, account_number FROM organizations WHERE id = $1', [targetOrganizationId]);

  await req.logAudit({
    action: 'create', entityType: 'person_organization', entityId: req.params.id, entityName: person.name,
    newValues: { organizationId: targetOrganizationId, organizationName: orgRows[0]?.name },
  });
  res.status(201).json({
    organization: { id: rows[0]?.id, organization_id: targetOrganizationId, name: orgRows[0]?.name, account_number: orgRows[0]?.account_number },
  });
});

router.delete('/:id/organizations/:orgId', requireRole('customer_admin'), async (req, res) => {
  const { rows: personRows } = await pool.query('SELECT id, name, organization_id FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  const person = personRows[0];
  if (!person) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, person.organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!scopeAllows(scopedIds, req.params.orgId)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { rows } = await pool.query(
    'DELETE FROM person_organizations WHERE person_id = $1 AND organization_id = $2 RETURNING id',
    [req.params.id, req.params.orgId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await req.logAudit({
    action: 'delete', entityType: 'person_organization', entityId: req.params.id, entityName: person.name,
    oldValues: { organizationId: req.params.orgId },
  });
  res.status(204).end();
});

router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  const isSelf = req.user.id === req.params.id;
  const isAdminTier = req.user.role === 'global_admin' || req.user.role === 'customer_admin';
  if (!isSelf && !isAdminTier) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!isSelf) {
    const { rows } = await pool.query('SELECT organization_id FROM people WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const scopedIds = await resolveScopedOrgIds(req);
    if (!scopeAllows(scopedIds, rows[0].organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const key = assetKey('person-photos', req.file.originalname);
  const url = await uploadAsset(key, req.file.buffer, req.file.mimetype);
  await pool.query('UPDATE people SET photo_url = $1, updated_at = now() WHERE id = $2', [url, req.params.id]);
  res.json({ photoUrl: await resolveAssetUrl(url) });
});

router.delete('/:id', requireRole('customer_admin'), async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT organization_id FROM people WHERE id = $1 AND is_deleted = false', [req.params.id]);
  if (!existingRows[0]) return res.status(404).json({ error: 'Not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopeAllows(scopedIds, existingRows[0].organization_id)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { rows } = await pool.query(
    `UPDATE people SET is_deleted = true, deleted_at = now(), deleted_by = $1
     WHERE id = $2 AND is_deleted = false RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await req.logAudit({ action: 'delete', entityType: 'person', entityId: req.params.id, entityName: rows[0].name });
  res.status(204).end();
});

function scopeAllows(scopedIds, organizationId) {
  return scopedIds === null || scopedIds.includes(organizationId);
}

export default router;
