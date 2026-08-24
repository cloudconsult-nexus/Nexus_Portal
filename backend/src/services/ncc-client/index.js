// Clean facade over the NCC (Nextiva Contact Center / Thrio) adapter —
// this is the only module the rest of the app should import from
// (build brief: "Don't scatter raw HTTP calls through the app... if/when
// service-API-key auth becomes available, swapping the auth mechanism
// won't touch calling code"). Internals (auth.js/http.js/config.js) are
// not meant to be imported directly outside this directory.
import pool from '../../db/pool.js';
import * as messages from './messages.js';
import * as customers from './customers.js';
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

export const { getAllCustomers, searchCustomers, getCustomerById, createCustomer } = customers;

export async function isNccConfigured(organizationId) {
  return !!(await resolveNccCredentials(organizationId));
}

// Explicit, admin-triggered action (routes/nccDebug.js) — NOT an automatic
// side effect of POST /organizations. Two reasons this stayed manual for
// this phase rather than firing on every Customer creation:
//
//   1. organizations only has one free-text `address` field; NCC's Create
//      Customer wants structured city/state/zip/country/slaPeriod, none of
//      which the Portal collects yet. Auto-pushing today would either
//      create incomplete NCC customer records on every Customer creation
//      or require a data-model/form change that's out of scope for the
//      fetch-layer phase (that's a real product decision — capture those
//      fields on the Customer, or leave them NCC-side-only — worth a
//      dedicated pass rather than deciding silently here).
//   2. This push has never run against the live API — see the debug route
//      and the build's "not verified live" notes. Wiring an unverified
//      external write into a core creation flow (which would also be hard
//      to reverse — it creates a real record in NCC) is exactly the kind
//      of thing to confirm works before making automatic.
//
// Once both are resolved, this is the function to call from
// routes/organizations.js's POST handler.
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

  // Response shape is unverified (build brief: "Capture a real ... customer
  // payload on first successful fetch ... fields ... aren't fully known
  // yet") — defensively check the field names that would make sense from
  // the collection (`id`) before falling back to a second guess.
  const nccCustomerId = created?.id ?? created?.customerId ?? null;
  if (!nccCustomerId) {
    nccLog({ event: 'push-customer-warning', organizationId, note: 'Create Customer response had no recognizable id field — response shape needs confirming with Patrick', responseKeys: created && typeof created === 'object' ? Object.keys(created) : typeof created });
    throw new NccApiError('NCC Create Customer succeeded but returned no recognizable customer id — see logs', { body: created });
  }

  await setNccCustomerId(organizationId, String(nccCustomerId));
  return { nccCustomerId: String(nccCustomerId), raw: created };
}
