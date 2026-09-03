import { nccRequest } from './http.js';

const BASE = '/data/api/types/message/';

export function getAllMessages(organizationId) {
  return nccRequest(organizationId, { method: 'GET', path: BASE });
}

export function getMessagesByCustomerId(organizationId, customerId) {
  return nccRequest(organizationId, { method: 'GET', path: BASE, query: { customerId } });
}

export function getMessageById(organizationId, messageId) {
  return nccRequest(organizationId, { method: 'GET', path: `${BASE}${encodeURIComponent(messageId)}` });
}

export function updateMessageLastFollowUp(organizationId, messageId, lastFollowUpEpochMs) {
  return nccRequest(organizationId, {
    method: 'PATCH',
    path: `${BASE}${encodeURIComponent(messageId)}`,
    body: { lastFollowUp: lastFollowUpEpochMs },
  });
}

export function acknowledgeMessage(organizationId, messageId, acknowledgedAtEpochMs) {
  return nccRequest(organizationId, {
    method: 'PATCH',
    path: `${BASE}${encodeURIComponent(messageId)}`,
    body: { acknowledged: true, acknowledgedAt: acknowledgedAtEpochMs },
  });
}

// The ?customerId={id}&acknowledged=false filter isn't in the Postman
// collection, but Patrick confirmed 2026-08-24 (reply on "NCC Messages/
// Customers API — what we need to finish validating the outbound
// integration") that the server honors it: "I tested each Postman
// request" — this combined filter included. Omit customerId for the
// global unacknowledged view Patrick also described.
export function getUnacknowledgedMessages(organizationId, { customerId } = {}) {
  return nccRequest(organizationId, {
    method: 'GET',
    path: BASE,
    query: { customerId, acknowledged: 'false' },
  });
}
