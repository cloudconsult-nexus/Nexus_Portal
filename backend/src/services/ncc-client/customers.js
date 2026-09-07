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

// Phase B2 of the NCC dev/release plan: keep the linked NCC Customer in
// sync with edits made in Nexus Portal. Same addresss/address translation
// as create/search — only the fields actually passed in are sent, so a
// partial edit (e.g. just `name`) doesn't clobber fields NCC already has
// that the Portal doesn't collect yet (city/state/zip/country/slaPeriod/
// description — see services/ncc-client/index.js#pushOrganizationToNcc).
export function updateCustomer(organizationId, nccCustomerId, { zip, country, address, city, slaPeriod, description, phone, name, state } = {}) {
  const body = {};
  if (zip !== undefined) body.zip = zip;
  if (country !== undefined) body.country = country;
  if (address !== undefined) body.addresss = address;
  if (city !== undefined) body.city = city;
  if (slaPeriod !== undefined) body.slaPeriod = slaPeriod;
  if (description !== undefined) body.description = description;
  if (phone !== undefined) body.phone = phone;
  if (name !== undefined) body.name = name;
  if (state !== undefined) body.state = state;

  return nccRequest(organizationId, {
    method: 'PATCH',
    path: `${BASE}${encodeURIComponent(nccCustomerId)}`,
    body,
  });
}
