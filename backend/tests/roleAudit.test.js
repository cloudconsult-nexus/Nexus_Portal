import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { setupFixtures, teardownFixtures, tokenFor, personIdFor, getFixtureOrgId } from './support/fixtures.js';
import { ALL_ROLES, ENDPOINT_CHECKS, READ_CHECKS } from './support/roleMatrix.js';

// Every assertion below is also pushed into `results`, and dumped to
// tests/results/backend-role-audit.json in afterAll — the raw material
// scripts/generate-role-docs.mjs turns into ROLE_AUDIT_REPORT.md. This is
// what makes the audit report a record of what the API actually did on this
// run, not a hand-typed claim about what it should do.
const results = [];

function resolvePath(template, { useFixtureOrgId } = {}) {
  const idValue = useFixtureOrgId ? getFixtureOrgId() : randomUUID();
  return template.replace(/:id\b/g, idValue).replace(/:orgId\b/g, randomUUID());
}

function send(method, urlPath, token, opts) {
  const req = request(app)[method](resolvePath(urlPath, opts)).set('Accept', 'application/json');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({});
}

function record({ area, capability, op, method, path: p, role, expectedAllowed, status }) {
  const pass = expectedAllowed ? status !== 401 && status !== 403 : status === 403;
  results.push({ area, capability, op, method: method.toUpperCase(), path: p, role, expectedAllowed, status, pass });
  return pass;
}

beforeAll(async () => {
  await setupFixtures();
}, 20000);

afterAll(async () => {
  await teardownFixtures();

  const outDir = path.join(process.cwd(), 'tests', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'backend-role-audit.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)
  );
});

describe('rejects an unauthenticated request', () => {
  it('GET /organizations with no token returns 401', async () => {
    const res = await send('get', '/organizations', null);
    expect(res.status).toBe(401);
  });
});

describe('CRUD / reports / messaging authorization matrix', () => {
  for (const check of ENDPOINT_CHECKS) {
    describe(`${check.method.toUpperCase()} ${check.path} (${check.op})`, () => {
      for (const role of ALL_ROLES) {
        const expectedAllowed = check.allowedRoles.includes(role);
        it(`${expectedAllowed ? 'allows' : 'denies'} ${role}`, async () => {
          const res = await send(check.method, check.path, tokenFor(role), { useFixtureOrgId: check.useFixtureOrgId });
          const pass = record({ ...check, role, expectedAllowed, status: res.status });
          if (expectedAllowed) {
            expect(res.status, `expected ${role} to clear the auth boundary, got ${res.status}`).not.toBe(403);
            expect(res.status, `expected ${role} to be authenticated, got ${res.status}`).not.toBe(401);
          } else {
            expect(res.status, `expected ${role} to be denied with 403, got ${res.status}`).toBe(403);
          }
          expect(pass).toBe(true);
        });
      }
    });
  }
});

describe('open read endpoints (no role gate)', () => {
  for (const check of READ_CHECKS) {
    describe(`${check.method.toUpperCase()} ${check.path} (${check.op})`, () => {
      for (const role of ALL_ROLES) {
        it(`${role} clears authentication and authorization`, async () => {
          const res = await send(check.method, check.path, tokenFor(role));
          record({ ...check, role, expectedAllowed: true, status: res.status });
          expect(res.status).not.toBe(401);
          expect(res.status).not.toBe(403);
        });
      }
    });
  }
});

// people.js's requireSelfOrOrgAdmin is a data-dependent gate (id === self)
// rather than a static role gate, so it doesn't fit ENDPOINT_CHECKS' shape —
// exercised directly here instead.
describe('self-or-org-admin: POST /people/:id/photo', () => {
  it('an Employee (read_only) may act on their own record', async () => {
    const selfId = personIdFor('read_only');
    const res = await send('post', `/people/${selfId}/photo`, tokenFor('read_only'));
    record({ area: 'people', capability: 'crud', op: 'update-own-photo', method: 'post', path: '/people/:id/photo', role: 'read_only', expectedAllowed: true, status: res.status });
    expect(res.status).not.toBe(403);
  });

  it("an Employee (read_only) may not act on another person's record", async () => {
    const otherId = personIdFor('technician');
    const res = await send('post', `/people/${otherId}/photo`, tokenFor('read_only'));
    const pass = record({ area: 'people', capability: 'crud', op: 'update-others-photo', method: 'post', path: '/people/:id/photo', role: 'read_only', expectedAllowed: false, status: res.status });
    expect(res.status).toBe(403);
    expect(pass).toBe(true);
  });

  it('an Org Admin may act on any record', async () => {
    const otherId = personIdFor('technician');
    const res = await send('post', `/people/${otherId}/photo`, tokenFor('org_admin'));
    record({ area: 'people', capability: 'crud', op: 'update-others-photo', method: 'post', path: '/people/:id/photo', role: 'org_admin', expectedAllowed: true, status: res.status });
    expect(res.status).not.toBe(403);
  });
});
