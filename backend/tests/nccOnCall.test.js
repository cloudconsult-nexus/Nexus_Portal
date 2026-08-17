import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import pool from '../src/db/pool.js';

// See /root/.claude/plans/inherited-cuddling-turtle.md for the full design
// discussion this endpoint was built against (timezone source, auth
// mechanism, multi-calendar merge behavior — all confirmed with the
// client before writing this).
//
// Fixture data is self-contained in this file (its own org/calendar/
// people/assignment rows, inserted directly, not reused from anywhere
// else) rather than depending on tests/support/fixtures.js, which
// tests/roleAudit.test.js needs but isn't tracked in this repo (a
// pre-existing gap in this sandbox, confirmed earlier this session,
// unrelated to this feature).
//
// Auth gating (401/501, no DB needed) lives in tests/nccOnCallAuth.test.js
// — kept separate so it can't be affected by this file's DB-fixture setup.
// Everything in this file needs a real Postgres instance — this sandbox
// doesn't have one, so these tests are written to the plan's spec but
// **not verified here**. Run against a real test DB (locally or CI)
// before trusting them.

const NCC_KEY = 'test-ncc-shared-key';

describe('NCC on-call lookup — resolution (needs a live test DB, unverified in this sandbox)', () => {
  // America/Phoenix has no DST — avoids any DST-transition math in this
  // test's fixed date/time fixtures.
  const TIMEZONE = 'America/Phoenix';
  const SHIFT_DATE = '2026-09-01';
  const SHIFT_START = '09:00:00';
  const SHIFT_END = '17:00:00';
  // 13:00 Phoenix (UTC-7) = 20:00 UTC — well inside the shift window above.
  const AT_DURING_SHIFT = '2026-09-01T20:00:00Z';
  const AT_OUTSIDE_SHIFT = '2026-09-02T20:00:00Z'; // no assignment covers this date at all

  let orgId;
  let otherCalendarId;
  let calendarIds = [];
  let personIds = {};
  let assignmentIds = [];
  let priorTimezone;

  beforeAll(async () => {
    process.env.NCC_API_KEY = NCC_KEY;

    const { rows: settingsRows } = await pool.query('SELECT id, timezone FROM tas_settings LIMIT 1');
    priorTimezone = settingsRows[0]?.timezone;
    await pool.query('UPDATE tas_settings SET timezone = $1 WHERE id = $2', [TIMEZONE, settingsRows[0].id]);

    const { rows: orgRows } = await pool.query(
      `INSERT INTO organizations (name) VALUES ('NCC Test Org') RETURNING id`
    );
    orgId = orgRows[0].id;

    const { rows: calRows } = await pool.query(
      `INSERT INTO calendars (organization_id, name) VALUES ($1, 'Main Line'), ($1, 'After Hours') RETURNING id`,
      [orgId]
    );
    calendarIds = calRows.map((r) => r.id);
    otherCalendarId = calendarIds[1];

    async function makePerson(name) {
      const { rows } = await pool.query(
        `INSERT INTO people (organization_id, name, primary_phone, sms_phone, email)
         VALUES ($1, $2, '555-0100', '555-0101', $3) RETURNING id`,
        [orgId, name, `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`]
      );
      return rows[0].id;
    }
    personIds = {
      primary: await makePerson('Primary Person'),
      secondary: await makePerson('Secondary Person'),
      tertiary: await makePerson('Tertiary Person'),
      default: await makePerson('Default Person'),
      otherCalendarPrimary: await makePerson('Other Calendar Primary'),
    };

    // Scenario A (exact-match): all four tiers set, on the first calendar.
    const { rows: fullRow } = await pool.query(
      `INSERT INTO assignments (calendar_id, date, start_time, end_time, mode, primary_person_id, secondary_person_id, tertiary_person_id, default_person_id)
       VALUES ($1, $2, $3, $4, 'escalation', $5, $6, $7, $8) RETURNING id`,
      [calendarIds[0], SHIFT_DATE, SHIFT_START, SHIFT_END, personIds.primary, personIds.secondary, personIds.tertiary, personIds.default]
    );
    assignmentIds.push(fullRow[0].id);

    // Scenario C (multiple people on call): a second calendar also staffed
    // at the same moment, different primary/default.
    const { rows: otherRow } = await pool.query(
      `INSERT INTO assignments (calendar_id, date, start_time, end_time, mode, primary_person_id, default_person_id)
       VALUES ($1, $2, $3, $4, 'escalation', $5, $5) RETURNING id`,
      [otherCalendarId, SHIFT_DATE, SHIFT_START, SHIFT_END, personIds.otherCalendarPrimary]
    );
    assignmentIds.push(otherRow[0].id);
  }, 20000);

  afterAll(async () => {
    await pool.query('DELETE FROM assignments WHERE id = ANY($1)', [assignmentIds]);
    await pool.query('DELETE FROM people WHERE id = ANY($1)', [Object.values(personIds)]);
    await pool.query('DELETE FROM calendars WHERE id = ANY($1)', [calendarIds]);
    await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    if (priorTimezone) {
      await pool.query('UPDATE tas_settings SET timezone = $1 WHERE timezone = $2', [priorTimezone, TIMEZONE]);
    }
    await pool.end();
  });

  it('resolves multiple people on call across two calendars, tagged with roles, merged and ordered', async () => {
    const res = await request(app)
      .get(`/ncc/organizations/${orgId}/on-call?at=${encodeURIComponent(AT_DURING_SHIFT)}`)
      .set('Authorization', `Bearer ${NCC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.onCall.map((p) => p.role)).toEqual(['primary', 'primary', 'secondary', 'tertiary', 'default', 'default']);
    const primaryNames = res.body.onCall.filter((p) => p.role === 'primary').map((p) => p.name);
    expect(primaryNames).toEqual(expect.arrayContaining(['Primary Person', 'Other Calendar Primary']));
  });

  it('falls back to primary + default only when secondary/tertiary are unset for that slot', async () => {
    // The second calendar's assignment only ever had primary+default set —
    // isolate it by removing the first calendar's row for this check.
    await pool.query('DELETE FROM assignments WHERE id = $1', [assignmentIds[0]]);

    const res = await request(app)
      .get(`/ncc/organizations/${orgId}/on-call?at=${encodeURIComponent(AT_DURING_SHIFT)}`)
      .set('Authorization', `Bearer ${NCC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.onCall.map((p) => p.role)).toEqual(['primary', 'default']);
    expect(res.body.onCall.every((p) => p.name === 'Other Calendar Primary')).toBe(true);
  });

  it('returns an empty coverage-gap response when nothing is scheduled for that moment', async () => {
    const res = await request(app)
      .get(`/ncc/organizations/${orgId}/on-call?at=${encodeURIComponent(AT_OUTSIDE_SHIFT)}`)
      .set('Authorization', `Bearer ${NCC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ organizationId: orgId, at: AT_OUTSIDE_SHIFT, onCall: [], coverageGap: true });
  });

  it('404s for a nonexistent organization id', async () => {
    const res = await request(app)
      .get(`/ncc/organizations/${randomUUID()}/on-call?at=${encodeURIComponent(AT_DURING_SHIFT)}`)
      .set('Authorization', `Bearer ${NCC_KEY}`);

    expect(res.status).toBe(404);
  });

  it('400s on an invalid timestamp', async () => {
    const res = await request(app)
      .get(`/ncc/organizations/${orgId}/on-call?at=not-a-real-timestamp`)
      .set('Authorization', `Bearer ${NCC_KEY}`);

    expect(res.status).toBe(400);
  });
});
