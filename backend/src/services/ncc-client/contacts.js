import { nccRequest } from './http.js';

// Contact is a native Thrio platform object (api.thrio.com's "CRM Contact
// Object"), unlike Message/Customer which are custom types Nextiva built on
// top of the generic /data/api/types/{typeName}/ framework — see the NCC
// dev/release plan's Section 0. Get Contact by ID follows the same
// path pattern as the documented POST .../types/contact create call.
const BASE = '/data/api/types/contact/';

export function getContactById(organizationId, contactId) {
  return nccRequest(organizationId, { method: 'GET', path: `${BASE}${encodeURIComponent(contactId)}` });
}
