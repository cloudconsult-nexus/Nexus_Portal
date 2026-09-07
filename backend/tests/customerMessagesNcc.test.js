import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import pool from '../src/db/pool.js';
import { signToken } from '../src/middleware/auth.js';
import { resetTokenCacheForTests } from '../src/services/ncc-client/auth.js';
import { clearOrganizationCredentials, clearTasCredentials } from '../src/services/ncc-client/config.js';

// Route-level coverage for /customer-messages/ncc — the real (metadata-only)
// Customer Messages feature, open to Customer Admin+ (unlike /ncc-debug),
// scoped to the caller's own Customer + descendants (resolveScopedOrgIds).
let orgA, orgB, globalAdmin, customerAdminA, regularUserA;

async function insertOrg(name, parentId = null) {
  const { rows } = await pool.query('INSERT INTO organizations (name, parent_id) VALUES ($1, $2) RETURNING *', [name, parentId]);
  return rows[0];
}

async function insertPerson(name, organizationId, role) {
  const { rows } = await pool.query(
    `INSERT INTO people (organization_id, name, email, role) VALUES ($1, $2, $3, $4) RETURNING *`,
    [organizationId, name, `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`, role]
  );
  return rows[0];
}

let fetchMock;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

beforeAll(async () => {
  orgA = await insertOrg('NCC Messages Test Customer A');
  orgB = await insertOrg('NCC Messages Test Customer B');
  globalAdmin = await insertPerson('Gia GlobalAdmin', orgA.id, 'global_admin');
  customerAdminA = await insertPerson('Cody CustomerAdminA', orgA.id, 'customer_admin');
  regularUserA = await insertPerson('Uma User A', orgA.id, 'user');
});

afterAll(async () => {
  await pool.query('DELETE FROM ncc_org_config WHERE organization_id IN ($1, $2)', [orgA.id, orgB.id]);
  await pool.query('DELETE FROM people WHERE organization_id IN ($1, $2)', [orgA.id, orgB.id]);
  await pool.query('DELETE FROM organizations WHERE id IN ($1, $2)', [orgA.id, orgB.id]);
  await pool.end();
});

beforeEach(async () => {
  resetTokenCacheForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await clearOrganizationCredentials(orgA.id);
  await clearOrganizationCredentials(orgB.id);
  await clearTasCredentials();
});

describe('/customer-messages/ncc authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get(`/customer-messages/ncc/messages?organizationId=${orgA.id}`);
    expect(res.status).toBe(401);
  });

  it('rejects a plain User (Customer Admin+ only)', async () => {
    const res = await request(app)
      .get(`/customer-messages/ncc/messages?organizationId=${orgA.id}`)
      .set('Authorization', `Bearer ${signToken(regularUserA)}`);
    expect(res.status).toBe(403);
  });

  it('rejects a Customer Admin reading a Customer outside their own scope', async () => {
    const res = await request(app)
      .get(`/customer-messages/ncc/messages?organizationId=${orgB.id}`)
      .set('Authorization', `Bearer ${signToken(customerAdminA)}`);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports not-configured as an empty list rather than an error', async () => {
    const res = await request(app)
      .get(`/customer-messages/ncc/messages?organizationId=${orgA.id}`)
      .set('Authorization', `Bearer ${signToken(customerAdminA)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, messages: [] });
  });
});

// Content used to be stripped unconditionally pending a compliance-gate
// decision (Phase 5.2) — the NCC dev/release plan's Phase C1 (decided
// 2026-09-07) resolved that gate as role-based, so content now passes
// through to any Customer Admin+ this router already lets in (see the
// route file's header comment).
describe('/customer-messages/ncc/messages content (un-masked, Phase C1)', () => {
  it('returns full message content to a Customer Admin, and resolves contactId to a display name', async () => {
    const token = signToken(customerAdminA);
    await request(app).put(`/ncc-config/${orgA.id}`).set('Authorization', `Bearer ${signToken(globalAdmin)}`).send({ username: 'org-user', password: 'org-pass' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          next: '0',
          total: '1',
          previous: '0',
          count: 1,
          objects: [
            { _id: 'm1', messageId: 'm1', objectType: 'message', customerId: 'c1', contactId: 'contact-1', priority: '3', message: 'lease renewal details for unit 4B', acknowledged: false, createdAt: 1 },
          ],
        })
      )
      // Get Contact by ID — one lookup per unique contactId in the page.
      .mockResolvedValueOnce(jsonResponse(200, { _id: 'contact-1', firstName: 'Paul', lastName: 'Barnes' }));

    const res = await request(app).get(`/customer-messages/ncc/messages?organizationId=${orgA.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ _id: 'm1', priority: '3', acknowledged: false, message: 'lease renewal details for unit 4B', contactName: 'Paul Barnes' });
  });

  it('falls back to the raw contactId when the contact lookup fails', async () => {
    const token = signToken(customerAdminA);
    await request(app).put(`/ncc-config/${orgA.id}`).set('Authorization', `Bearer ${signToken(globalAdmin)}`).send({ username: 'org-user', password: 'org-pass' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { next: '0', total: '1', previous: '0', count: 1, objects: [{ _id: 'm1', contactId: 'contact-404', acknowledged: false }] })
      )
      .mockResolvedValueOnce(jsonResponse(404, { error: 'not found' }));

    const res = await request(app).get(`/customer-messages/ncc/messages?organizationId=${orgA.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.messages[0]).toMatchObject({ _id: 'm1', contactId: 'contact-404', contactName: null });
  });

  it('acknowledging a message returns full content and passes the real actor\'s identity to NCC', async () => {
    const token = signToken(customerAdminA);
    await request(app).put(`/ncc-config/${orgA.id}`).set('Authorization', `Bearer ${signToken(globalAdmin)}`).send({ username: 'org-user', password: 'org-pass' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(200, { _id: 'm1', message: 'lease renewal details for unit 4B', acknowledged: true, acknowledgedAt: 123 }));

    const res = await request(app)
      .patch(`/customer-messages/ncc/messages/m1/acknowledge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ organizationId: orgA.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ _id: 'm1', acknowledged: true, message: 'lease renewal details for unit 4B' });

    // Second fetch call is the actual PATCH to NCC (the first authenticates) —
    // Phase D1: the actor's identity (not the shared NCC credential's) rides
    // along in the body, best-effort/unconfirmed field name.
    const [, patchInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(patchInit.body)).toMatchObject({ modifiedBy: customerAdminA.email });
  });

  it('a Global Admin can read any Customer regardless of scope', async () => {
    const token = signToken(globalAdmin);
    await request(app).put(`/ncc-config/${orgB.id}`).set('Authorization', `Bearer ${token}`).send({ username: 'org-user', password: 'org-pass' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(200, { next: '0', total: '0', previous: '0', count: 0, objects: [] }));

    const res = await request(app).get(`/customer-messages/ncc/messages?organizationId=${orgB.id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, messages: [] });
  });
});
