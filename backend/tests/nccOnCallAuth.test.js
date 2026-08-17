import { randomUUID } from 'crypto';
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

// Auth gating for the NCC on-call endpoint (lib/nccAuth.js, routes/
// nccOnCall.js) — no DB needed, same "always runnable" bar as
// tests/backups.test.js. Kept in its own file, separate from
// tests/nccOnCall.test.js's DB-fixture-dependent resolution tests: sharing
// a file meant both describe blocks mutated process.env.NCC_API_KEY, and
// the DB-dependent block's beforeAll set it before failing on its (sandbox
// -only, expected) DB connection error — polluting these tests via shared
// file-level state. Full isolation avoids that regardless of hook timing.
describe('NCC on-call lookup — auth gating', () => {
  it('501s when NCC_API_KEY is not configured', async () => {
    delete process.env.NCC_API_KEY;
    const res = await request(app).get(`/ncc/organizations/${randomUUID()}/on-call?at=2026-01-01T00:00:00Z`);
    expect(res.status).toBe(501);
  });

  it('401s with no Authorization header', async () => {
    process.env.NCC_API_KEY = 'test-ncc-shared-key';
    const res = await request(app).get(`/ncc/organizations/${randomUUID()}/on-call?at=2026-01-01T00:00:00Z`);
    expect(res.status).toBe(401);
  });

  it('401s with a wrong key', async () => {
    process.env.NCC_API_KEY = 'test-ncc-shared-key';
    const res = await request(app)
      .get(`/ncc/organizations/${randomUUID()}/on-call?at=2026-01-01T00:00:00Z`)
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(401);
  });
});
