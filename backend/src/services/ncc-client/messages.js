import { nccRequest } from './http.js';
import { nccLog } from './logger.js';

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

// UNVERIFIED against the live API — build brief: "Patrick described being
// able to search 'unacknowledged messages by customer ID,' but the
// collection doesn't include an explicit filter for it. Test combining
// ?customerId={id}&acknowledged=false ... and confirm the server actually
// honors it before building anything on top of it." That live check
// couldn't be done in this environment (no NCC credentials/network access
// here) — this sends the filter Patrick described and logs a warning tag
// on every call so it's easy to grep for and re-verify once this runs
// against the real API. Omit customerId for the global unacknowledged view
// Patrick also described.
export function getUnacknowledgedMessages(organizationId, { customerId } = {}) {
  nccLog({
    event: 'unverified-filter',
    filter: 'acknowledged=false',
    organizationId,
    customerId: customerId || null,
    note: 'not present in the Postman collection — confirm the server honors this before relying on it',
  });
  return nccRequest(organizationId, {
    method: 'GET',
    path: BASE,
    query: { customerId, acknowledged: 'false' },
  });
}
