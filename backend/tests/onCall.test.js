import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import pool from '../src/db/pool.js';

// Coverage for GET /organizations/:orgId/on-call — the NCC-facing lookup
// (routes/onCall.js, lib/calendarService.js#getOnCallAt, CLAUDE.md Phase
// 5.4). Self-contained fixtures inserted directly via pool.query, following
// errorHandling.test.js's plain supertest(app) style rather than importing
// tests/support/fixtures.js — that module (imported by tests/roleAudit.test.js)
// doesn't exist in the repo and is a separate, pre-existing gap (see
// tests/support/setupEnv.js's comment).
const TIMEZONE = 'America/Chicago'; // UTC-5 on the fixture date below (CDT)
const DATE = '2026-08-18'; // matches "today" per CLAUDE.md's currentDate

let org, otherCalendarOrg;
let calendarWithChain, calendarDefaultOnly, calendarNoConfig;
let primary, secondary, tertiary, slotDefault, calendarDefault;

async function insertOrg(name, timezone = TIMEZONE) {
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, timezone) VALUES ($1, $2) RETURNING *`,
    [name, timezone]
  );
  return rows[0];
}

async function insertPerson(name, organizationId) {
  const { rows } = await pool.query(
    `INSERT INTO people (organization_id, name, primary_phone, sms_phone, email, role)
     VALUES ($1, $2, '+15555550100', '+15555550101', $3, 'user') RETURNING *`,
    [organizationId, name, `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`]
  );
  return rows[0];
}

async function insertCalendar(organizationId, name, defaultPersonId = null) {
  const { rows } = await pool.query(
    `INSERT INTO calendars (organization_id, name, default_person_id) VALUES ($1, $2, $3) RETURNING *`,
    [organizationId, name, defaultPersonId]
  );
  return rows[0];
}

async function insertAssignment(calendarId, { startTime, endTime, primaryPersonId, secondaryPersonId, tertiaryPersonId, defaultPersonId }) {
  await pool.query(
    `INSERT INTO assignments (calendar_id, date, start_time, end_time, mode, primary_person_id, secondary_person_id, tertiary_person_id, default_person_id)
     VALUES ($1, $2, $3, $4, 'escalation', $5, $6, $7, $8)`,
    [calendarId, DATE, startTime, endTime, primaryPersonId || null, secondaryPersonId || null, tertiaryPersonId || null, defaultPersonId || null]
  );
}

beforeAll(async () => {
  org = await insertOrg('NCC Test Customer');
  otherCalendarOrg = await insertOrg('NCC Test Customer (org with no calendars)');

  primary = await insertPerson('Priya Primary', org.id);
  secondary = await insertPerson('Sam Secondary', org.id);
  tertiary = await insertPerson('Tara Tertiary', org.id);
  slotDefault = await insertPerson('Dana SlotDefault', org.id);
  calendarDefault = await insertPerson('Cal Default', org.id);

  // Calendar A: full escalation chain, 09:00–17:00 local, plus a
  // calendar-level default that should NOT surface while the chain covers
  // the requested instant (only used for a full coverage gap).
  calendarWithChain = await insertCalendar(org.id, 'Full Chain Calendar', calendarDefault.id);
  await insertAssignment(calendarWithChain.id, {
    startTime: '09:00:00',
    endTime: '17:00:00',
    primaryPersonId: primary.id,
    secondaryPersonId: secondary.id,
    tertiaryPersonId: tertiary.id,
    defaultPersonId: slotDefault.id,
  });

  // Calendar B: assignment row exists for the slot, but only default is
  // configured (no primary/secondary/tertiary) — the "default-only
  // fallback within a covered slot" case.
  calendarDefaultOnly = await insertCalendar(org.id, 'Default-Only Calendar');
  await insertAssignment(calendarDefaultOnly.id, {
    startTime: '09:00:00',
    endTime: '17:00:00',
    defaultPersonId: slotDefault.id,
  });

  // Calendar C: no assignment row at all for the requested instant — the
  // "full coverage gap" case, falls back to the calendar's own standing
  // default.
  calendarNoConfig = await insertCalendar(org.id, 'Coverage Gap Calendar', calendarDefault.id);
}, 20000);

afterAll(async () => {
  const orgIds = [org.id, otherCalendarOrg.id];
  await pool.query('DELETE FROM assignments WHERE calendar_id IN (SELECT id FROM calendars WHERE organization_id = ANY($1))', [orgIds]);
  await pool.query('DELETE FROM calendars WHERE organization_id = ANY($1)', [orgIds]);
  await pool.query('DELETE FROM people WHERE organization_id = ANY($1)', [orgIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
  await pool.end();
});

function get(path) {
  // Read lazily (not at module top-level) so it reflects setupEnv.js's
  // env var, which vitest applies before each test body runs, not
  // necessarily before this file's own top-level code evaluates.
  return request(app).get(path).set('X-API-Key', process.env.NCC_API_KEY);
}

describe('GET /organizations/:orgId/on-call', () => {
  it('requires the service API key', async () => {
    const res = await request(app).get(`/organizations/${org.id}/on-call?at=${DATE}T14:00:00Z`);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong API key', async () => {
    const res = await request(app)
      .get(`/organizations/${org.id}/on-call?at=${DATE}T14:00:00Z`)
      .set('X-API-Key', 'not-the-real-key');
    expect(res.status).toBe(401);
  });

  it('exact-match on-call: full chain resolves in primary → secondary → tertiary → default order', async () => {
    // 14:00 UTC = 09:00 America/Chicago (CDT, UTC-5) — start of the 09:00–17:00 slot.
    const res = await get(`/organizations/${org.id}/on-call?at=${DATE}T14:00:00Z`);
    expect(res.status).toBe(200);

    const fromChainCalendar = res.body.onCall.filter((p) => p.on_call_role !== 'default' || p.id === slotDefault.id);
    const roles = fromChainCalendar
      .filter((p) => [primary.id, secondary.id, tertiary.id, slotDefault.id].includes(p.id))
      .map((p) => p.on_call_role);
    expect(roles).toEqual(['primary', 'secondary', 'tertiary', 'default']);

    const primaryEntry = res.body.onCall.find((p) => p.id === primary.id);
    expect(primaryEntry).toMatchObject({
      name: 'Priya Primary',
      email: 'priya.primary@example.test',
      primary_phone: '+15555550100',
      sms_phone: '+15555550101',
      on_call_role: 'primary',
    });
  });

  it('default-only fallback: a slot with no primary/secondary/tertiary still returns the default contact', async () => {
    const res = await get(`/organizations/${org.id}/on-call?at=${DATE}T14:00:00Z`);
    expect(res.status).toBe(200);
    const defaultOnlyEntries = res.body.onCall.filter((p) => p.id === slotDefault.id);
    // slotDefault appears once for the full-chain calendar and once for the
    // default-only calendar — both tagged 'default'.
    expect(defaultOnlyEntries.length).toBeGreaterThanOrEqual(1);
    expect(defaultOnlyEntries.every((p) => p.on_call_role === 'default')).toBe(true);
  });

  it('full coverage gap: no assignment row at all falls back to the calendar-level default, never empty', async () => {
    // 03:00 UTC = 22:00 America/Chicago the prior day (CDT) — outside every
    // configured assignment window, but within calendarNoConfig, which has
    // no assignment rows at all for any time.
    const res = await get(`/organizations/${org.id}/on-call?at=${DATE}T22:00:00-05:00`);
    expect(res.status).toBe(200);
    const gapCalendarEntries = res.body.onCall.filter((p) => p.id === calendarDefault.id);
    expect(gapCalendarEntries.length).toBeGreaterThanOrEqual(1);
    expect(gapCalendarEntries[0].on_call_role).toBe('default');
  });

  it('multiple people on call in the same slot are all returned, default always last', async () => {
    const res = await get(`/organizations/${org.id}/on-call?at=${DATE}T15:00:00Z`);
    expect(res.status).toBe(200);
    const ids = res.body.onCall.map((p) => p.id);
    expect(ids).toContain(primary.id);
    expect(ids).toContain(secondary.id);
    expect(ids).toContain(tertiary.id);

    const roleRank = { primary: 0, secondary: 1, tertiary: 2, default: 3 };
    const ranks = res.body.onCall.map((p) => roleRank[p.on_call_role]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('an organization with no calendars returns an empty list, not an error', async () => {
    const res = await get(`/organizations/${otherCalendarOrg.id}/on-call?at=${DATE}T14:00:00Z`);
    expect(res.status).toBe(200);
    expect(res.body.onCall).toEqual([]);
  });

  it('invalid organization ID: well-formed but nonexistent UUID returns 404', async () => {
    const res = await get(`/organizations/${randomUUID()}/on-call?at=${DATE}T14:00:00Z`);
    expect(res.status).toBe(404);
  });

  it('invalid organization ID: malformed UUID returns 400', async () => {
    const res = await get(`/organizations/not-a-uuid/on-call?at=${DATE}T14:00:00Z`);
    expect(res.status).toBe(400);
  });

  it('rejects a missing/invalid `at` parameter', async () => {
    const res = await get(`/organizations/${org.id}/on-call`);
    expect(res.status).toBe(400);
  });
});

// Regression for the 2026-08-19 incident: onCall.js and organizations.js
// (routes/organizations.js) are two separate routers both mounted at the
// '/organizations' prefix (app.js). requireApiKey used to be attached via
// `router.use(requireApiKey)` in onCall.js, which — because it's mounted
// first — ran for every request under '/organizations/*' before Express
// tried matching a specific route, not just for '/:orgId/on-call'. That
// swallowed GET /organizations (list customers) and every other
// organizations route behind NCC's service-API-key check, 500ing with
// "Service authentication is not configured" whenever NCC_API_KEY wasn't
// set — which looked exactly like "all customers were deleted" in the UI
// (Customers.jsx fell through to its empty state on any fetch error). No
// data was ever touched. Fix: requireApiKey is now attached only to the
// '/:orgId/on-call' route itself.
describe('onCall router does not shadow sibling /organizations/* routes', () => {
  it('GET /organizations reaches organizationsRoutes’ human auth, not onCall’s service-key auth', async () => {
    const res = await request(app).get('/organizations');
    // organizationsRoutes' requireAuth rejects a missing Bearer token this
    // way. If onCall's router.use(requireApiKey) were shadowing this route
    // again, the response would instead be a 401 "Missing or invalid API
    // key" (or, with NCC_API_KEY unset, a 500 "Service authentication is
    // not configured") — neither of which is what a human client's login
    // flow expects to see from the Customers list.
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing or invalid Authorization header');
  });
});
