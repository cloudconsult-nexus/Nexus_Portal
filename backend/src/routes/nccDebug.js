import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import * as ncc from '../services/ncc-client/index.js';

// Minimal internal debug view (build brief: "It's fine to leave the
// existing 'Not configured' screens as-is, or add a minimal internal
// debug view to confirm the pipe works") — NOT the Customer Messages/
// Secure Messaging UI, which is an explicitly out-of-scope follow-up
// phase designed collaboratively. This exists to let Tom/Patrick exercise
// every operation against a real Customer's NCC config from Postman/curl
// (or an internal-only screen later) while validating the adapter, without
// building product UI for it.
//
// Global Admin only. Every operation writes to NCC's live data for
// mutating calls (acknowledge/last-follow-up/create) — this is a real
// integration test surface, not a sandbox, so treat it accordingly.
const router = Router();
router.use(requireAuth, requireRole('global_admin'), auditContext);

// Translates the adapter's typed errors (services/ncc-client/errors.js)
// into a response that's actually useful for debugging with Patrick —
// the generic error handler's flat 500 would hide exactly the status/body
// detail this route exists to surface.
function respondError(res, err) {
  if (err.name === 'NccNotConfiguredError') {
    return res.status(409).json({ error: err.message });
  }
  if (err.name === 'NccAuthError') {
    return res.status(502).json({ error: err.message, nccStatus: err.status, nccBody: err.body });
  }
  if (err.name === 'NccApiError') {
    return res.status(502).json({ error: err.message, nccStatus: err.status, nccBody: err.body, method: err.method, path: err.path });
  }
  throw err; // not an NCC error — let app.js's centralized handler deal with it
}

router.get('/:orgId/status', async (req, res) => {
  res.json(await ncc.getNccStatus(req.params.orgId));
});

router.get('/:orgId/messages', async (req, res) => {
  try {
    const { customerId } = z.object({ customerId: z.string().optional() }).parse(req.query);
    const result = customerId
      ? await ncc.getMessagesByCustomerId(req.params.orgId, customerId)
      : await ncc.getAllMessages(req.params.orgId);
    res.json(result);
  } catch (err) {
    respondError(res, err);
  }
});

router.get('/:orgId/messages/unacknowledged', async (req, res) => {
  try {
    const { customerId } = z.object({ customerId: z.string().optional() }).parse(req.query);
    res.json(await ncc.getUnacknowledgedMessages(req.params.orgId, { customerId }));
  } catch (err) {
    respondError(res, err);
  }
});

router.get('/:orgId/messages/:messageId', async (req, res) => {
  try {
    res.json(await ncc.getMessageById(req.params.orgId, req.params.messageId));
  } catch (err) {
    respondError(res, err);
  }
});

router.patch('/:orgId/messages/:messageId/last-follow-up', async (req, res) => {
  try {
    const { lastFollowUp } = z.object({ lastFollowUp: z.number().int() }).parse(req.body);
    const result = await ncc.updateMessageLastFollowUp(req.params.orgId, req.params.messageId, lastFollowUp);
    // entity_id is a UUID column (migrations/001_init.sql) — NCC message
    // ids aren't UUIDs, so the id goes in entity_name (TEXT) instead.
    await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: req.params.messageId, newValues: { lastFollowUp } });
    res.json(result);
  } catch (err) {
    respondError(res, err);
  }
});

router.patch('/:orgId/messages/:messageId/acknowledge', async (req, res) => {
  try {
    const { acknowledgedAt } = z.object({ acknowledgedAt: z.number().int() }).parse(req.body);
    const result = await ncc.acknowledgeMessage(req.params.orgId, req.params.messageId, acknowledgedAt);
    await req.logAudit({ action: 'update', entityType: 'ncc_message', entityName: req.params.messageId, newValues: { acknowledged: true, acknowledgedAt } });
    res.json(result);
  } catch (err) {
    respondError(res, err);
  }
});

router.get('/:orgId/customers', async (req, res) => {
  try {
    const { name, address, phone } = z
      .object({ name: z.string().optional(), address: z.string().optional(), phone: z.string().optional() })
      .parse(req.query);
    const result = name || address || phone
      ? await ncc.searchCustomers(req.params.orgId, { name, address, phone })
      : await ncc.getAllCustomers(req.params.orgId);
    res.json(result);
  } catch (err) {
    respondError(res, err);
  }
});

router.get('/:orgId/customers/:nccCustomerId', async (req, res) => {
  try {
    res.json(await ncc.getCustomerById(req.params.orgId, req.params.nccCustomerId));
  } catch (err) {
    respondError(res, err);
  }
});

const createCustomerSchema = z.object({
  name: z.string().min(1),
  zip: z.string().optional(),
  country: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  slaPeriod: z.union([z.string(), z.number()]).optional(),
  description: z.string().optional(),
  phone: z.string().optional(),
  state: z.string().optional(),
});

router.post('/:orgId/customers', async (req, res) => {
  try {
    const input = createCustomerSchema.parse(req.body);
    const result = await ncc.createCustomer(req.params.orgId, input);
    await req.logAudit({ action: 'create', entityType: 'ncc_customer', entityName: input.name, newValues: result });
    res.status(201).json(result);
  } catch (err) {
    respondError(res, err);
  }
});

// Explicit push of an EXISTING Portal Customer's own record to NCC (see
// services/ncc-client/index.js#pushOrganizationToNcc for why this is a
// manual action rather than automatic on Customer creation for now).
router.post('/:orgId/push-to-ncc', async (req, res) => {
  try {
    const result = await ncc.pushOrganizationToNcc(req.params.orgId);
    await req.logAudit({ action: 'create', entityType: 'ncc_customer', entityId: req.params.orgId, newValues: result });
    res.status(201).json(result);
  } catch (err) {
    respondError(res, err);
  }
});

export default router;
