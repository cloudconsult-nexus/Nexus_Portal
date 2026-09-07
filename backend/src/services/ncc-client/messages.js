import { nccRequest } from './http.js';

const BASE = '/data/api/types/message/';

// Phase E1/E2 of the NCC dev/release plan: bound message list fetches to a
// trailing date window instead of a customer's full history (some TAS
// accounts could reach millions of messages over their lifetime). The
// rangeType/rangeFrom/rangeTo shape is a REAL, documented convention
// (Section 0 of the plan) already used by NCC's Recording search and
// Workitem History APIs — but Patrick's team hasn't confirmed the message
// search endpoint itself honors it (E2, still open). Sent best-effort: a
// server that ignores it is no worse off than an unbounded fetch was
// already; one that honors it gets the bounded fetch this phase needs.
// routes/customerMessages.js applies a client-side date filter as a
// defense-in-depth backstop either way.
function rangeParams(range) {
  return range ? { rangeType: 'dateRange', rangeFrom: range.rangeFrom, rangeTo: range.rangeTo } : {};
}

export function getAllMessages(organizationId, range) {
  return nccRequest(organizationId, { method: 'GET', path: BASE, query: rangeParams(range) });
}

export function getMessagesByCustomerId(organizationId, customerId, range) {
  return nccRequest(organizationId, { method: 'GET', path: BASE, query: { customerId, ...rangeParams(range) } });
}

export function getMessageById(organizationId, messageId) {
  return nccRequest(organizationId, { method: 'GET', path: `${BASE}${encodeURIComponent(messageId)}` });
}

// `actor` (Phase D1 of the NCC dev/release plan) carries the real logged-in
// Nexus Portal user's identity, not the shared NCC service credential's —
// today's auth is a per-tenant/per-Customer Basic-auth login
// (services/ncc-client/auth.js), so there's no per-user NCC session to
// authenticate as. `modifiedBy` here is a BEST-GUESS field name, not one
// Patrick's team has confirmed accepts/persists — this needs verifying
// against the live API (or a real field name from Patrick's successor)
// before relying on NCC's own "modified by" reflecting it. Sent
// best-effort; omitted entirely if no actor is given, so it can't break a
// call that doesn't need it.
function actorFields(actor) {
  return actor?.email || actor?.name ? { modifiedBy: actor.email || actor.name } : {};
}

export function updateMessageLastFollowUp(organizationId, messageId, lastFollowUpEpochMs, actor) {
  return nccRequest(organizationId, {
    method: 'PATCH',
    path: `${BASE}${encodeURIComponent(messageId)}`,
    body: { lastFollowUp: lastFollowUpEpochMs, ...actorFields(actor) },
  });
}

export function acknowledgeMessage(organizationId, messageId, acknowledgedAtEpochMs, actor) {
  return nccRequest(organizationId, {
    method: 'PATCH',
    path: `${BASE}${encodeURIComponent(messageId)}`,
    body: { acknowledged: true, acknowledgedAt: acknowledgedAtEpochMs, ...actorFields(actor) },
  });
}

// The ?customerId={id}&acknowledged=false filter isn't in the Postman
// collection, but Patrick confirmed 2026-08-24 (reply on "NCC Messages/
// Customers API — what we need to finish validating the outbound
// integration") that the server honors it: "I tested each Postman
// request" — this combined filter included. Omit customerId for the
// global unacknowledged view Patrick also described.
export function getUnacknowledgedMessages(organizationId, { customerId, range } = {}) {
  return nccRequest(organizationId, {
    method: 'GET',
    path: BASE,
    query: { customerId, acknowledged: 'false', ...rangeParams(range) },
  });
}
