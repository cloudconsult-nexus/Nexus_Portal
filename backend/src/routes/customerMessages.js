import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';
import * as ncc from '../services/ncc-client/index.js';
import { nccLog } from '../services/ncc-client/logger.js';
import { getMessageLookbackDays } from '../services/ncc-client/config.js';

// Nav/permission scaffolding only (CLAUDE.md: "do not build a real external
// integration unless explicitly asked") — no database table backs this.
// Configuration is a single global embed target via env vars, not a
// per-org catalog like report_mappings.
//
// GET / below is that original generic-embed stub, unchanged. Everything
// under /ncc/* is the real feature (Phase 5.2, scoped 2026-09-03 per
// NCCMessageIntegrationGuide.docx's Q&A) built on top of the now
// live-verified services/ncc-client outbound layer — see that module's
// header comment ("eventually the real Customer Messages feature").
const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const configured = !!process.env.CUSTOMER_MESSAGING_URL;
  if (!configured) {
    return res.json({ configured: false });
  }

  let embedUrl = process.env.CUSTOMER_MESSAGING_URL;
  if (process.env.CUSTOMER_MESSAGING_SSO_SECRET) {
    const token = jwt.sign(
      { userId: req.user.id, role: req.user.role },
      process.env.CUSTOMER_MESSAGING_SSO_SECRET,
      { expiresIn: '10m' }
    );
    const tokenParam = process.env.CUSTOMER_MESSAGING_TOKEN_PARAM || 'token';
    const separator = embedUrl.includes('?') ? '&' : '?';
    embedUrl = `${embedUrl}${separator}${encodeURIComponent(tokenParam)}=${token}`;
  }

  res.json({ configured: true, embedUrl });
});

// --- Real Customer Messages feature (Phase 5.2), metadata only -----------
//
// Open to Customer Admin and above (same audience as the nav item —
// frontend/src/lib/roles.js#canViewMessages), unlike /ncc-debug which is
// Global Admin only. Every route below enforces org scope itself
// (resolveScopedOrgIds / assertOrgInScope) since these are no longer
// Global-Admin-only and a Customer Admin must not be able to read another
// Customer's NCC messages by guessing an organizationId.
const nccRouter = Router();
nccRouter.use(requireRole('customer_admin'), auditContext);

// Per NCCMessageIntegrationGuide.docx §2, NCC's message envelope carries
// full free-text content (names, financial/legal detail — real PHI-
// adjacent content in the live data seen 2026-09-02/03), and the target
// spec's compliance gate on viewing it was left an open placeholder (role
// flag / re-auth / consent — undecided) when Phase 5.2 first shipped this
// router with `message` stripped out of every response.
//
// NCC dev/release plan (call with Patrick Hoye and Steve Newell,
// 2026-09-04), Phase C1 + decision confirmed 2026-09-07: that gate is
// resolved as role-based — the same `requireRole('customer_admin')` this
// whole router already enforces above is the gate. Message content is no
// longer stripped from any response below; it passes through untouched to
// any Customer Admin+ this router already lets in. (No NCC iframe
// integration either, per the same call — fetch-live-and-render-natively,
// as this router already does, is the confirmed direction, not a stopgap.)

// Phase A1 of the NCC dev/release plan: resolve a message's contactId to a
// display name via NCC's (documented, native-platform — see
// services/ncc-client/contacts.js) Get Contact by ID, rather than showing
// the raw id. Contact is a single field on NCC's side (the message only
// carries the id), so the First + Last name composition happens here.
// Deduped per request — a message list can repeat the same contact many
// times over. Never throws: a lookup failure falls back to the raw id
// rather than breaking the whole list.
async function resolveContactNames(organizationId, objects) {
  const contactIds = [...new Set(objects.map((m) => m.contactId).filter(Boolean))];
  const names = new Map();
  await Promise.all(
    contactIds.map(async (contactId) => {
      try {
        const contact = await ncc.getContactById(organizationId, contactId);
        const first = contact?.firstName || '';
        const last = contact?.lastName || '';
        const name = [first, last].filter(Boolean).join(' ').trim();
        if (name) names.set(contactId, name);
      } catch (err) {
        nccLog({ event: 'contact-lookup-failed', organizationId, contactId, error: err.message });
      }
    })
  );
  return objects.map((m) => ({ ...m, contactName: (m.contactId && names.get(m.contactId)) || null }));
}

// Confirms `orgId` is inside the caller's own scope (their Customer + every
// descendant — resolveScopedOrgIds) or, for Global Admin, always allows it.
// resolveScopedOrgIds itself only reads organizationId from req.query/body,
// not from a route param, so this route-param case needs its own check.
async function assertOrgInScope(req, orgId) {
  if (req.user.role === 'global_admin') return;
  const scopedIds = await resolveScopedOrgIds(req);
  if (!scopedIds.includes(orgId)) {
    const err = new Error('Customer is outside your scope');
    err.status = 403;
    throw err;
  }
}

function respondNccError(res, err) {
  if (err.status === 403) return res.status(403).json({ error: err.message });
  if (err.name === 'NccNotConfiguredError') {
    return res.status(200).json({ configured: false, messages: [] });
  }
  if (err.name === 'NccAuthError' || err.name === 'NccApiError') {
    return res.status(502).json({ error: err.message, nccStatus: err.status, nccBody: err.body });
  }
  throw err; // not an NCC error — let app.js's centralized handler deal with it
}

// GET /ncc/messages?organizationId=<id>&acknowledged=true|false
//
// One Customer at a time, like OnCall Reports' Organization picker
// (frontend/src/pages/OnCallReports.jsx) — a Customer Admin/User's own
// descendant tree can span several Customers, each with its own NCC
// credentials/tenant, so "everything in scope" isn't a single fetch.
nccRouter.get('/messages', async (req, res) => {
  try {
    const { organizationId, acknowledged } = z
      .object({ organizationId: z.string().min(1), acknowledged: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    await assertOrgInScope(req, organizationId);

    const status = await ncc.getNccStatus(organizationId);
    // Phase E1: bound the fetch to a trailing window instead of a
    // Customer's full history — see services/ncc-client/messages.js's
    // rangeParams() comment on why this is sent best-effort (E2 is still
    // unconfirmed). rangeFrom/rangeTo below double as the client-side
    // backstop applied after the fetch, so the bound holds either way.
    const lookbackDays = await getMessageLookbackDays(organizationId);
    const rangeTo = Date.now();
    const rangeFrom = rangeTo - lookbackDays * 24 * 60 * 60 * 1000;
    const range = { rangeFrom, rangeTo };

    let result;
    if (acknowledged === 'false') {
      result = await ncc.getUnacknowledgedMessages(organizationId, { customerId: status.nccCustomerId || undefined, range });
    } else {
      result = status.nccCustomerId
        ? await ncc.getMessagesByCustomerId(organizationId, status.nccCustomerId, range)
        : await ncc.getAllMessages(organizationId, range);
    }

    let objects = result?.objects || [];
    // `acknowledged=true` isn't a confirmed server-side filter (only
    // `acknowledged=false` was verified against the live API per the
    // 2026-08-24 confirmation — see services/ncc-client/messages.js) — so
    // it's applied client-side here rather than trusted on the wire.
    if (acknowledged === 'true') objects = objects.filter((m) => m.acknowledged === true);
    // Client-side backstop for the lookback window — createdAt is a msec
    // epoch per the message envelope's existing shape. A message missing
    // createdAt is kept rather than dropped (better to over- than
    // under-show while the server-side filter is unconfirmed).
    objects = objects.filter((m) => !m.createdAt || Number(m.createdAt) >= rangeFrom);
    objects = await resolveContactNames(organizationId, objects);

    res.json({
      configured: true, organizationId, nccCustomerId: status.nccCustomerId || null,
      lookbackDays, total: objects.length, messages: objects,
    });
  } catch (err) {
    respondNccError(res, err);
  }
});

// Phase D2: NCC's own "acknowledged by"/"modified by" isn't a reliable
// source of who acknowledged a message once real identity matters — Phase
// D1's actor pass-through is best-effort/unconfirmed, and NCC auth itself
// is a shared per-Customer/TAS credential, not a per-user NCC session (see
// services/ncc-client/messages.js's actorFields() comment). This Customer
// Messages feature's own audit trail — already recorded on every
// acknowledge by the PATCH handler below — is the durable, Portal-owned
// record instead: reused here rather than a new table, since audit_logs
// already carries exactly what D2 asked for (who + when, independent of
// NCC state, queryable months later).
nccRouter.get('/messages/:messageId/acknowledgment', async (req, res) => {
  try {
    const { organizationId } = z.object({ organizationId: z.string().min(1) }).parse(req.query);
    await assertOrgInScope(req, organizationId);

    const { rows } = await pool.query(
      `SELECT user_id, user_email, created_at FROM audit_logs
       WHERE entity_type = 'ncc_message' AND entity_name = $1 AND organization_id = $2
         AND action = 'update' AND (new_values->>'acknowledged') = 'true'
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.messageId, organizationId]
    );
    const row = rows[0];
    res.json({
      acknowledgedByUserId: row?.user_id || null,
      acknowledgedByEmail: row?.user_email || null,
      acknowledgedAt: row?.created_at || null,
    });
  } catch (err) {
    respondNccError(res, err);
  }
});

const orgBodySchema = z.object({ organizationId: z.string().min(1) });

nccRouter.patch('/messages/:messageId/acknowledge', async (req, res) => {
  try {
    const { organizationId } = orgBodySchema.parse(req.body);
    await assertOrgInScope(req, organizationId);
    const acknowledgedAt = Date.now();
    // Phase D1: pass the real logged-in Nexus Portal user's identity down
    // to NCC — see services/ncc-client/messages.js's actorFields() comment
    // on why this is best-effort/unconfirmed rather than a settled field.
    const result = await ncc.acknowledgeMessage(organizationId, req.params.messageId, acknowledgedAt, { name: req.user.name, email: req.user.email });
    // entity_id is a UUID column (migrations/001_init.sql) — NCC message
    // ids aren't UUIDs, so the id goes in entity_name (TEXT) instead.
    await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: req.params.messageId, organizationId, newValues: { acknowledged: true, acknowledgedAt } });
    res.json(result);
  } catch (err) {
    respondNccError(res, err);
  }
});

nccRouter.patch('/messages/:messageId/follow-up', async (req, res) => {
  try {
    const { organizationId } = orgBodySchema.parse(req.body);
    await assertOrgInScope(req, organizationId);
    const lastFollowUp = Date.now();
    const result = await ncc.updateMessageLastFollowUp(organizationId, req.params.messageId, lastFollowUp, { name: req.user.name, email: req.user.email });
    await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: req.params.messageId, organizationId, newValues: { lastFollowUp } });
    res.json(result);
  } catch (err) {
    respondNccError(res, err);
  }
});

router.use('/ncc', nccRouter);

export default router;
