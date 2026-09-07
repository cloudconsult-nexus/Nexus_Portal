// Clean facade over the NCC (Nextiva Contact Center / Thrio) adapter —
// this is the only module the rest of the app should import from
// (build brief: "Don't scatter raw HTTP calls through the app... if/when
// service-API-key auth becomes available, swapping the auth mechanism
// won't touch calling code"). Internals (auth.js/http.js/config.js) are
// not meant to be imported directly outside this directory.
import pool from '../../db/pool.js';
import * as messages from './messages.js';
import * as customers from './customers.js';
import * as contacts from './contacts.js';
import { resolveNccCredentials, getNccStatus, setNccCustomerId } from './config.js';
import { nccLog } from './logger.js';
import { NccApiError } from './errors.js';

export { NccNotConfiguredError, NccAuthError, NccApiError } from './errors.js';
export { getNccStatus } from './config.js';

export const {
  getAllMessages,
  getMessagesByCustomerId,
  getMessageById,
  updateMessageLastFollowUp,
  acknowledgeMessage,
  getUnacknowledgedMessages,
} = messages;

export const { getAllCustomers, searchCustomers, getCustomerById, createCustomer, updateCustomer } = customers;
export const { getContactById } = contacts;

export async function isNccConfigured(organizationId) {
  return !!(await resolveNccCredentials(organizationId));
}

// Phase B1 of the NCC dev/release plan (2026-09-07): now wired into
// routes/organizations.js's POST handler as a best-effort side effect of
// Customer creation — this was previously a manual, admin-triggered-only
// action (routes/nccDebug.js still exposes it directly for that use) while
// two blockers held:
//
//   1. organizations only has one free-text `address` field; NCC's Create
//      Customer wants structured city/state/zip/country/slaPeriod, none of
//      which the Portal collects yet — resolved by shipping a partial sync
//      (name/phone/address only) rather than extending the Customer schema
//      first; city/state/zip/country/slaPeriod/description stay NCC-side-
//      only for now (see the create body below).
//   2. This push had never run against the live API — resolved: live-
//      verified 2026-09-02/03 (see CLAUDE.md's Build history).
//
// Caller (routes/organizations.js) treats a failure here as non-fatal to
// Customer creation itself — an NCC outage or a not-yet-configured
// credential shouldn't block the Portal's own core "create a Customer"
// flow, which has no NCC dependency of its own.
export async function pushOrganizationToNcc(organizationId) {
  const { rows } = await pool.query('SELECT id, name, phone, email, address FROM organizations WHERE id = $1', [organizationId]);
  const org = rows[0];
  if (!org) throw new Error(`Organization ${organizationId} not found`);

  const created = await customers.createCustomer(organizationId, {
    name: org.name,
    phone: org.phone || undefined,
    address: org.address || undefined,
    // city/state/zip/country/slaPeriod/description: not yet captured on
    // organizations — see comment above.
  });

  // Field names confirmed by Patrick 2026-08-24 (reply on "NCC Messages/
  // Customers API — what we need to finish validating the outbound
  // integration"): "the ID is returned in the _id and customerId fields."
  // `_id` checked first per his ordering; `customerId` as the documented
  // alternate; `id` kept as a last-resort fallback in case a future API
  // version changes shape — cheap insurance, not a guess we're relying on.
  //
  // He also confirmed creating a customer with a name that already exists
  // returns 409 — that surfaces as a normal NccApiError with status 409
  // from http.js, nothing extra to handle here.
  const nccCustomerId = created?._id ?? created?.customerId ?? created?.id ?? null;
  if (!nccCustomerId) {
    nccLog({ event: 'push-customer-warning', organizationId, note: 'Create Customer response had no recognizable id field (_id/customerId/id) — unexpected given Patrick\'s confirmed shape, worth a follow-up', responseKeys: created && typeof created === 'object' ? Object.keys(created) : typeof created });
    throw new NccApiError('NCC Create Customer succeeded but returned no recognizable customer id — see logs', { body: created });
  }

  await setNccCustomerId(organizationId, String(nccCustomerId));
  return { nccCustomerId: String(nccCustomerId), raw: created };
}

// Phase B2: PATCH the linked NCC Customer when the Nexus Portal Organization
// record is edited. Called (best-effort, same non-fatal treatment as
// pushOrganizationToNcc above) from routes/organizations.js's PUT handler.
// A Customer with no linked NCC customer yet (never pushed, or push failed)
// has nothing to update — this is a no-op, not an error, since B1 already
// owns creating the link.
export async function pushOrganizationUpdateToNcc(organizationId) {
  const status = await getNccStatus(organizationId);
  if (!status.nccCustomerId) return null;

  const { rows } = await pool.query('SELECT name, phone, address FROM organizations WHERE id = $1', [organizationId]);
  const org = rows[0];
  if (!org) throw new Error(`Organization ${organizationId} not found`);

  const updated = await customers.updateCustomer(organizationId, status.nccCustomerId, {
    name: org.name,
    phone: org.phone || undefined,
    address: org.address || undefined,
  });
  return { nccCustomerId: status.nccCustomerId, raw: updated };
}
