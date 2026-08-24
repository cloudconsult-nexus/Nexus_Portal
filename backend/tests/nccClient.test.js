import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import pool from '../src/db/pool.js';
import { encryptSecret, decryptSecret } from '../src/lib/secretsCrypto.js';
import {
  resolveNccCredentials,
  upsertOrganizationCredentials,
  clearOrganizationCredentials,
  upsertTasCredentials,
  clearTasCredentials,
  getNccStatus,
  setNccCustomerId,
} from '../src/services/ncc-client/config.js';
import { resetTokenCacheForTests } from '../src/services/ncc-client/auth.js';
import * as ncc from '../src/services/ncc-client/index.js';

// Coverage for services/ncc-client — the outbound NCC (Nextiva Contact
// Center / Thrio) adapter (Phase 5.2 fetch layer). This is CONTRACT
// testing against a mocked fetch, built from the Postman collection's
// documented request/response shapes — it verifies the adapter builds the
// right requests and handles auth/refresh/errors correctly, NOT that
// Thrio's live API actually behaves as documented. No live NCC
// credentials or network access were available to run this against the
// real login.thrio.com — see the build handoff notes for what still needs
// live verification with Patrick (real token TTL, the unacknowledged-
// messages filter, real payload shapes).
let org;
let fetchMock;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

beforeAll(async () => {
  const { rows } = await pool.query(`INSERT INTO organizations (name) VALUES ('NCC Client Test Customer') RETURNING *`);
  org = rows[0];
});

afterAll(async () => {
  await pool.query('DELETE FROM ncc_org_config WHERE organization_id = $1', [org.id]);
  await pool.query('DELETE FROM organizations WHERE id = $1', [org.id]);
  await pool.end();
});

beforeEach(async () => {
  resetTokenCacheForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await clearOrganizationCredentials(org.id);
  await clearTasCredentials();
});

describe('lib/secretsCrypto', () => {
  it('round-trips a secret', () => {
    const encoded = encryptSecret('hunter2');
    expect(encoded).not.toContain('hunter2');
    expect(decryptSecret(encoded)).toBe('hunter2');
  });

  it('produces a different ciphertext each time (random IV) but decrypts the same', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it('rejects a tampered ciphertext instead of returning garbage', () => {
    const encoded = encryptSecret('hunter2');
    const tampered = encoded.slice(0, -4) + (encoded.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('credential resolution (Customer override -> TAS-wide -> not configured)', () => {
  it('returns null when nothing is configured at either tier', async () => {
    expect(await resolveNccCredentials(org.id)).toBeNull();
  });

  it('falls back to TAS-wide credentials when the Customer has no override', async () => {
    await upsertTasCredentials({ username: 'tas-user', password: 'tas-pass' });
    const cred = await resolveNccCredentials(org.id);
    expect(cred).toMatchObject({ scope: 'tas_settings', username: 'tas-user', password: 'tas-pass' });
  });

  it("prefers the Customer's own override over the TAS-wide default", async () => {
    await upsertTasCredentials({ username: 'tas-user', password: 'tas-pass' });
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'org-pass' });
    const cred = await resolveNccCredentials(org.id);
    expect(cred).toMatchObject({ scope: 'organization', username: 'org-user', password: 'org-pass' });
  });

  it('carries the ncc_customer_id even when auth falls back to the TAS-wide tier', async () => {
    await upsertTasCredentials({ username: 'tas-user', password: 'tas-pass' });
    await setNccCustomerId(org.id, 'ncc-cust-123');
    const cred = await resolveNccCredentials(org.id);
    expect(cred).toMatchObject({ scope: 'tas_settings', nccCustomerId: 'ncc-cust-123' });
  });

  it('getNccStatus never exposes the decrypted credentials', async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'super-secret' });
    const status = await getNccStatus(org.id);
    expect(JSON.stringify(status)).not.toContain('super-secret');
    expect(status).toMatchObject({ configured: true, scope: 'organization' });
  });
});

describe('auth (token-with-authorities)', () => {
  it('sends HTTP Basic auth to the documented endpoint and caches the token', async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'org-pass' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(200, []));

    await ncc.getAllMessages(org.id);

    const [authUrl, authOpts] = fetchMock.mock.calls[0];
    expect(authUrl).toBe('https://login.thrio.com/provider/token-with-authorities');
    expect(authOpts.headers.Authorization).toBe(`Basic ${Buffer.from('org-user:org-pass').toString('base64')}`);

    const [apiUrl, apiOpts] = fetchMock.mock.calls[1];
    expect(apiUrl).toBe('https://tenant1.thrio.com/data/api/types/message/');
    // Plain token header, not "Bearer <token>" — must match the collection exactly.
    expect(apiOpts.headers.Authorization).toBe('tok-1');

    // A second call within the assumed TTL reuses the cached token — no second auth call.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await ncc.getAllMessages(org.id);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('persists the location domain and auth timestamp on success', async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'org-pass' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(200, []));

    await ncc.getAllMessages(org.id);
    const status = await getNccStatus(org.id);
    expect(status.locationDomain).toBe('tenant1.thrio.com');
    expect(status.lastAuthAt).toBeTruthy();
    expect(status.lastAuthError).toBeNull();
  });

  it('records the auth failure and throws NccAuthError on bad credentials', async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'wrong' });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid credentials' }));

    await expect(ncc.getAllMessages(org.id)).rejects.toThrow('NCC authentication failed');
    const status = await getNccStatus(org.id);
    expect(status.lastAuthError).toContain('401');
  });

  it('throws NccNotConfiguredError and never calls fetch when nothing is configured', async () => {
    await expect(ncc.getAllMessages(org.id)).rejects.toMatchObject({ name: 'NccNotConfiguredError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-authenticates once on a 401 from an API call and retries successfully', async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'org-pass' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'stale-tok', location: 'tenant1.thrio.com' })) // initial auth
      .mockResolvedValueOnce(jsonResponse(401, { error: 'token expired' })) // first attempt rejected
      .mockResolvedValueOnce(jsonResponse(200, { token: 'fresh-tok', location: 'tenant1.thrio.com' })) // re-auth
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 'm1' }])); // retried call succeeds

    const result = await ncc.getAllMessages(org.id);
    expect(result).toEqual([{ id: 'm1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('fresh-tok');
  });

  it('gives up after a second consecutive 401 rather than looping', async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'org-pass' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-a', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-b', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(401, {}));

    await expect(ncc.getAllMessages(org.id)).rejects.toMatchObject({ name: 'NccApiError', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(4); // no third retry
  });
});

describe('messages operations — request shapes', () => {
  beforeEach(async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'org-pass' });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', location: 'tenant1.thrio.com' }));
  });

  it('getMessagesByCustomerId sends ?customerId=', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await ncc.getMessagesByCustomerId(org.id, 'cust-1');
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.pathname).toBe('/data/api/types/message/');
    expect(url.searchParams.get('customerId')).toBe('cust-1');
  });

  it('getMessageById hits the /{id} path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'm1' }));
    await ncc.getMessageById(org.id, 'm1');
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.pathname).toBe('/data/api/types/message/m1');
    expect(fetchMock.mock.calls[1][1].method).toBe('GET');
  });

  it('updateMessageLastFollowUp PATCHes { lastFollowUp }', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'm1' }));
    await ncc.updateMessageLastFollowUp(org.id, 'm1', 1755500000000);
    const [url, opts] = fetchMock.mock.calls[1];
    expect(new URL(url).pathname).toBe('/data/api/types/message/m1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ lastFollowUp: 1755500000000 });
  });

  it('acknowledgeMessage PATCHes { acknowledged: true, acknowledgedAt }', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'm1' }));
    await ncc.acknowledgeMessage(org.id, 'm1', 1755500000000);
    const [, opts] = fetchMock.mock.calls[1];
    expect(JSON.parse(opts.body)).toEqual({ acknowledged: true, acknowledgedAt: 1755500000000 });
  });

  it('getUnacknowledgedMessages (unverified filter) sends customerId + acknowledged=false together', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await ncc.getUnacknowledgedMessages(org.id, { customerId: 'cust-1' });
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.searchParams.get('customerId')).toBe('cust-1');
    expect(url.searchParams.get('acknowledged')).toBe('false');
  });

  it('getUnacknowledgedMessages omits customerId for the global view', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await ncc.getUnacknowledgedMessages(org.id);
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.searchParams.has('customerId')).toBe(false);
    expect(url.searchParams.get('acknowledged')).toBe('false');
  });
});

describe('customers operations — request shapes, incl. the addresss misspelling', () => {
  beforeEach(async () => {
    await upsertOrganizationCredentials(org.id, { username: 'org-user', password: 'org-pass' });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', location: 'tenant1.thrio.com' }));
  });

  it('searchCustomers sends name/addresss/phone as separate query params, our address -> their addresss', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await ncc.searchCustomers(org.id, { name: 'Acme', address: '123 Main St', phone: '555-0100' });
    const url = new URL(fetchMock.mock.calls[1][0]);
    expect(url.searchParams.get('name')).toBe('Acme');
    expect(url.searchParams.get('addresss')).toBe('123 Main St');
    expect(url.searchParams.get('phone')).toBe('555-0100');
    expect(url.searchParams.has('address')).toBe(false); // our spelling never reaches the wire
  });

  it('createCustomer POSTs the documented fields with addresss instead of address', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'ncc-cust-1' }));
    await ncc.createCustomer(org.id, {
      name: 'Acme', zip: '30301', country: 'US', address: '123 Main St',
      city: 'Atlanta', slaPeriod: '24h', description: 'test', phone: '555-0100', state: 'GA',
    });
    const [url, opts] = fetchMock.mock.calls[1];
    expect(new URL(url).pathname).toBe('/data/api/types/customer/');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.addresss).toBe('123 Main St');
    expect(body.address).toBeUndefined();
    expect(body).toMatchObject({ name: 'Acme', zip: '30301', country: 'US', city: 'Atlanta', slaPeriod: '24h', phone: '555-0100', state: 'GA' });
  });

  it('getCustomerById hits the /{id} path', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'ncc-cust-1' }));
    await ncc.getCustomerById(org.id, 'ncc-cust-1');
    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe('/data/api/types/customer/ncc-cust-1');
  });
});

describe('pushOrganizationToNcc', () => {
  it('creates the NCC customer and persists the returned id', async () => {
    await upsertTasCredentials({ username: 'tas-user', password: 'tas-pass' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'ncc-cust-99' }));

    const result = await ncc.pushOrganizationToNcc(org.id);
    expect(result.nccCustomerId).toBe('ncc-cust-99');

    const status = await getNccStatus(org.id);
    expect(status.nccCustomerId).toBe('ncc-cust-99');
  });

  it('throws (without silently dropping the write) when the response has no recognizable id', async () => {
    await upsertTasCredentials({ username: 'tas-user', password: 'tas-pass' });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(201, { status: 'ok' })); // no id/customerId field

    await expect(ncc.pushOrganizationToNcc(org.id)).rejects.toMatchObject({ name: 'NccApiError' });
  });
});
