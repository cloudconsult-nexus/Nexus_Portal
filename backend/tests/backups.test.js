import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Full Cloud SQL Admin API calls need live GCP credentials/an actual
// instance (INSTANCE_CONNECTION_NAME), neither of which exist in this test
// environment — see lib/cloudSql.js's isConfigured() guard, which is what
// keeps that path honestly untested here rather than faked. requireAuth
// (middleware/auth.js) does look a person up by id on every request, so
// pool.query is mocked below rather than assuming a live test database —
// same "no DB needed" bar tests/errorHandling.test.js already sets.
const PEOPLE = {
  'global-admin-id': { id: 'global-admin-id', email: 'ga@example.com', name: 'GA', role: 'global_admin', organization_id: null, is_active: true, is_deleted: false, mfa_enabled: false, can_edit_schedule: false },
  'customer-admin-id': { id: 'customer-admin-id', email: 'ca@example.com', name: 'CA', role: 'customer_admin', organization_id: null, is_active: true, is_deleted: false, mfa_enabled: false, can_edit_schedule: false },
};

vi.mock('../src/db/pool.js', () => ({
  default: { query: vi.fn((sql, params) => Promise.resolve({ rows: [PEOPLE[params?.[0]]].filter(Boolean) })) },
  pool: { query: vi.fn((sql, params) => Promise.resolve({ rows: [PEOPLE[params?.[0]]].filter(Boolean) })) },
}));

const { default: app } = await import('../src/app.js');

function tokenFor(personId) {
  return jwt.sign({ sub: personId }, process.env.JWT_SECRET);
}

describe('GET /backups', () => {
  it('401s without a token', async () => {
    const res = await request(app).get('/backups');
    expect(res.status).toBe(401);
  });

  it('403s for a non-Global-Admin role', async () => {
    const res = await request(app).get('/backups').set('Authorization', `Bearer ${tokenFor('customer-admin-id')}`);
    expect(res.status).toBe(403);
  });

  it('501s for a Global Admin when Cloud SQL is not configured (this test env)', async () => {
    const res = await request(app).get('/backups').set('Authorization', `Bearer ${tokenFor('global-admin-id')}`);
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/Cloud Run/);
  });
});

describe('POST /backups/:id/restore', () => {
  it('403s for a non-Global-Admin role', async () => {
    const res = await request(app)
      .post('/backups/some-id/restore')
      .set('Authorization', `Bearer ${tokenFor('customer-admin-id')}`)
      .send({ destinationInstanceName: 'oncall-pro-prod-pg-restored' });
    expect(res.status).toBe(403);
  });

  // The isConfigured() guard runs before body validation (no point
  // validating input for a feature that can't run here at all), so in this
  // DB-less test environment a Global Admin hits the same 501 as GET
  // /backups regardless of what's in the body — the 400-on-bad-name path
  // only exists once Cloud SQL is actually configured, which isn't
  // testable without live GCP credentials.
  it('501s for a Global Admin when Cloud SQL is not configured, before body validation runs', async () => {
    const res = await request(app)
      .post('/backups/some-id/restore')
      .set('Authorization', `Bearer ${tokenFor('global-admin-id')}`)
      .send({ destinationInstanceName: 'Not Valid!' });
    expect(res.status).toBe(501);
  });
});
