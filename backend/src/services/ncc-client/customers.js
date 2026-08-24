import { nccRequest } from './http.js';

const BASE = '/data/api/types/customer/';

export function getAllCustomers(organizationId) {
  return nccRequest(organizationId, { method: 'GET', path: BASE });
}

// NCC's own query param for address is misspelled "addresss" (three s's) —
// confirmed by Patrick as not a typo on our side, so it's matched exactly
// on the wire. Our own function signature stays spelled correctly
// (`address`) so that misspelling doesn't leak into the rest of the Portal
// codebase — this is the one place the translation happens.
export function searchCustomers(organizationId, { name, address, phone } = {}) {
  return nccRequest(organizationId, {
    method: 'GET',
    path: BASE,
    query: { name, addresss: address, phone },
  });
}

export function getCustomerById(organizationId, nccCustomerId) {
  return nccRequest(organizationId, { method: 'GET', path: `${BASE}${encodeURIComponent(nccCustomerId)}` });
}

// Same addresss/address translation as searchCustomers above, applied to
// the create body instead of query params.
export function createCustomer(organizationId, { zip, country, address, city, slaPeriod, description, phone, name, state } = {}) {
  return nccRequest(organizationId, {
    method: 'POST',
    path: BASE,
    body: { zip, country, addresss: address, city, slaPeriod, description, phone, name, state },
  });
}
