import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import pool from '../src/db/pool.js';
import { signToken } from '../src/middleware/auth.js';
import { resetTokenCacheForTests } from '../src/services/ncc-client/auth.js';
import { clearOrganizationCredentials, clearTasCredentials } from '../src/services/ncc-client/config.js';

// Route-level coverage for /ncc-config (credential CRUD, Global Admin only,
// never echoes a decrypted secret back) and /ncc-debug (the minimal
// internal pipe-check view, also Global Admin only — see routes/nccDebug.js
// and routes/nccConfig.js for why both are API-only with no frontend yet).
let org, globalAdmin, customerAdmin;
let fetchMock;

async function insertPerson(name, organizationId, role) {
  const { rows } = await pool.query(
    `INSERT INTO people (organization_id, name, email, role) VALUES ($1, $2, $3, $4) RETURNING *`,
    [organizationId, name, `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`, role]
  );
  return rows[0];
}

beforeAll(async () => {
  const { rows } = await pool.query(`INSERT INTO organizations (name) VALUES ('NCC Routes Test Customer') RETURNING *`);
  org = rows[0];
  globalAdmin = await insertPerson('Gia GlobalAdmin', org.id, 'global_admin');
  customerAdmin = await insertPerson('Cody CustomerAdmin', org.id, 'customer_admin');
});

afterAll(async () => {
  await pool.query('DELETE FROM ncc_org_config WHERE organization_id = $1', [org.id]);
  await pool.query('DELETE FROM people WHERE organization_id = $1', [org.id]);
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

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe('/ncc-config authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get(`/ncc-config/${org.id}`);
    expect(res.status).toBe(401);
  });

  it('rejects a Customer Admin (Global Admin only)', async () => {
    const res = await request(app).get(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${signToken(customerAdmin)}`);
    expect(res.status).toBe(403);
  });

  it('a Global Admin can set, read (without secret leakage), and clear org-level credentials', async () => {
    const token = signToken(globalAdmin);

    const putRes = await request(app)
      .put(`/ncc-config/${org.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'org-user', password: 'super-secret-password' });
    expect(putRes.status).toBe(200);
    expect(putRes.body.configured).toBe(true);
    expect(JSON.stringify(putRes.body)).not.toContain('super-secret-password');

    const getRes = await request(app).get(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.body).toMatchObject({ configured: true, scope: 'organization' });
    expect(JSON.stringify(getRes.body)).not.toContain('super-secret-password');

    const delRes = await request(app).delete(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(204);

    const afterDelete = await request(app).get(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${token}`);
    expect(afterDelete.body.configured).toBe(false);
  });

  it('404s for a nonexistent Customer', async () => {
    const res = await request(app)
      .put(`/ncc-config/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${signToken(globalAdmin)}`)
      .send({ username: 'u', password: 'p' });
    expect(res.status).toBe(404);
  });

  it('400s on a missing password (ZodError -> centralized handler)', async () => {
    const res = await request(app)
      .put(`/ncc-config/${org.id}`)
      .set('Authorization', `Bearer ${signToken(globalAdmin)}`)
      .send({ username: 'org-user' });
    expect(res.status).toBe(400);
  });

  it('sets and clears the TAS-wide default', async () => {
    const token = signToken(globalAdmin);
    const putRes = await request(app).put('/ncc-config/tas/default').set('Authorization', `Bearer ${token}`).send({ username: 'tas-user', password: 'tas-pass' });
    expect(putRes.status).toBe(200);

    const status = await request(app).get(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${token}`);
    expect(status.body).toMatchObject({ configured: true, scope: 'tas_settings' });

    const delRes = await request(app).delete('/ncc-config/tas/default').set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(204);
  });
});

describe('/ncc-debug authorization and pipe check', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get(`/ncc-debug/${org.id}/status`);
    expect(res.status).toBe(401);
  });

  it('rejects a Customer Admin', async () => {
    const res = await request(app).get(`/ncc-debug/${org.id}/status`).set('Authorization', `Bearer ${signToken(customerAdmin)}`);
    expect(res.status).toBe(403);
  });

  it('reports not configured with a 409 from the messages pipe when nothing is set up', async () => {
    const res = await request(app).get(`/ncc-debug/${org.id}/messages`).set('Authorization', `Bearer ${signToken(globalAdmin)}`);
    expect(res.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies a successful fetch end-to-end once credentials are configured', async () => {
    const token = signToken(globalAdmin);
    await request(app).put(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${token}`).send({ username: 'org-user', password: 'org-pass' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(200, [{ id: 'm1', subject: 'test message' }]));

    const res = await request(app).get(`/ncc-debug/${org.id}/messages`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'm1', subject: 'test message' }]);
  });

  it('translates an upstream NCC error into a 502 with the NCC status/body surfaced', async () => {
    const token = signToken(globalAdmin);
    await request(app).put(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${token}`).send({ username: 'org-user', password: 'org-pass' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'thrio internal error' }));

    const res = await request(app).get(`/ncc-debug/${org.id}/messages`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(502);
    expect(res.body.nccStatus).toBe(500);
  });

  it('creates a customer via the debug create route', async () => {
    const token = signToken(globalAdmin);
    await request(app).put(`/ncc-config/${org.id}`).set('Authorization', `Bearer ${token}`).send({ username: 'org-user', password: 'org-pass' });

    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'tok-1', location: 'tenant1.thrio.com' }))
      .mockResolvedValueOnce(jsonResponse(201, { id: 'ncc-cust-1' }));

    const res = await request(app)
      .post(`/ncc-debug/${org.id}/customers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme', address: '123 Main St', phone: '555-0100' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'ncc-cust-1' });
    const createBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(createBody.addresss).toBe('123 Main St');
  });
});
