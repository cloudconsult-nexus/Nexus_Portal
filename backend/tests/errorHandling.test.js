import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

// Regression coverage for the app.js centralized error handler: a thrown
// ZodError (every route's `schema.parse(req.body)` pattern) must surface as
// a 400 with details, not the generic 500 — see app.js for the live-repro
// that motivated this (a client sending HTTP Basic Auth, no JSON body, to
// /auth/login, and getting a 500 back instead of an actionable error).
describe('centralized error handler', () => {
  it('turns a ZodError from an invalid /auth/login body into a 400 with details', async () => {
    const res = await request(app).post('/auth/login').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
    expect(Array.isArray(res.body.details)).toBe(true);
    const paths = res.body.details.map((d) => d.path);
    expect(paths).toContain('email');
    expect(paths).toContain('password');
  });

  it('still 400s on a body with the wrong shape, not just a missing one', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'not-an-email', password: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
  });

  it('unrelated 404s are unaffected by the ZodError branch', async () => {
    const res = await request(app).get('/no-such-route');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
