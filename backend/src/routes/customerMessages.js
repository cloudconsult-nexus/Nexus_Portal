import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';
import * as ncc from '../services/ncc-client/index.js';

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

// Per NCCMessageIntegrationGuide.docx §2: NCC's message envelope carries
// full free-text content (names, financial/legal detail — real PHI-
// adjacent content in the live data seen 2026-09-02/03). The target spec
// says the Portal must never persist or display that content itself — only
// metadata. `message` is stripped here, at the one seam every response
// from this router passes through, rather than trusting every route below
// to remember to omit it.
function stripContent({ message, ...metadata }) {
  return metadata;
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
    let result;
    if (acknowledged === 'false') {
      result = await ncc.getUnacknowledgedMessages(organizationId, { customerId: status.nccCustomerId || undefined });
    } else {
      result = status.nccCustomerId
        ? await ncc.getMessagesByCustomerId(organizationId, status.nccCustomerId)
        : await ncc.getAllMessages(organizationId);
    }

    let objects = (result?.objects || []).map(stripContent);
    // `acknowledged=true` isn't a confirmed server-side filter (only
    // `acknowledged=false` was verified against the live API per the
    // 2026-08-24 confirmation — see services/ncc-client/messages.js) — so
    // it's applied client-side here rather than trusted on the wire.
    if (acknowledged === 'true') objects = objects.filter((m) => m.acknowledged === true);

    res.json({ configured: true, organizationId, nccCustomerId: status.nccCustomerId || null, total: objects.length, messages: objects });
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
    const result = await ncc.acknowledgeMessage(organizationId, req.params.messageId, acknowledgedAt);
    // entity_id is a UUID column (migrations/001_init.sql) — NCC message
    // ids aren't UUIDs, so the id goes in entity_name (TEXT) instead.
    await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: req.params.messageId, organizationId, newValues: { acknowledged: true, acknowledgedAt } });
    res.json(stripContent(result));
  } catch (err) {
    respondNccError(res, err);
  }
});

nccRouter.patch('/messages/:messageId/follow-up', async (req, res) => {
  try {
    const { organizationId } = orgBodySchema.parse(req.body);
    await assertOrgInScope(req, organizationId);
    const lastFollowUp = Date.now();
    const result = await ncc.updateMessageLastFollowUp(organizationId, req.params.messageId, lastFollowUp);
    await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: req.params.messageId, organizationId, newValues: { lastFollowUp } });
    res.json(stripContent(result));
  } catch (err) {
    respondNccError(res, err);
  }
});

router.use('/ncc', nccRouter);

export default router;
