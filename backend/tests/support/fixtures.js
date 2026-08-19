import jwt from 'jsonwebtoken';
import pool from '../../src/db/pool.js';

// Shared fixture set for the role-authorization audit
// (tests/roleAudit.test.js) — one organization, one person per current
// role tier (CLAUDE.md's 3-role model, post-Phase-5.1), and a valid JWT
// for each. Deliberately minimal: the audit only asserts whether a caller
// clears a route's auth/role boundary (not 401/403 for an allowed role,
// exactly 403 for a denied one — see roleAudit.test.js's `record()`), not
// full CRUD correctness, so these fixtures don't need to exercise every
// field a real record would have.
//
// This file (and tests/support/roleMatrix.js) previously didn't exist in
// this repo at all — roleAudit.test.js failed to import before any test
// in it could run, and ROLE_MATRIX.md/ROLE_AUDIT_REPORT.md couldn't be
// regenerated as a result. See RUNBOOK.md/ROLE_AUDIT_REPORT.md for that
// history; this rebuilds it for the current role model rather than the
// pre-Phase-5.1 one the old (lost) version of this file presumably had.
const ROLES = ['global_admin', 'customer_admin', 'user'];

let org;
const peopleByRole = {};
const tokensByRole = {};

export async function setupFixtures() {
  const { rows: orgRows } = await pool.query(
    `INSERT INTO organizations (name) VALUES ('Role Audit Fixture Org') RETURNING *`
  );
  org = orgRows[0];

  for (const role of ROLES) {
    const { rows } = await pool.query(
      `INSERT INTO people (organization_id, name, email, primary_phone, sms_phone, role, is_active, login_enabled)
       VALUES ($1, $2, $3, '+15555550100', '+15555550101', $4, true, true)
       RETURNING *`,
      [org.id, `Fixture ${role}`, `fixture.${role}@example.test`, role]
    );
    peopleByRole[role] = rows[0];
    // Same claim shape as middleware/auth.js's signToken ({ sub, role }) —
    // this deliberately mints tokens the same way login would, rather than
    // reusing signToken itself, so the audit also exercises the real JWT
    // verification path in middleware/auth.js#requireAuth end to end.
    tokensByRole[role] = jwt.sign({ sub: rows[0].id, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  }
}

export async function teardownFixtures() {
  if (org) {
    await pool.query('DELETE FROM people WHERE organization_id = $1', [org.id]);
    await pool.query('DELETE FROM organizations WHERE id = $1', [org.id]);
  }
  await pool.end();
}

export function tokenFor(role) {
  return tokensByRole[role];
}

export function personIdFor(role) {
  return peopleByRole[role].id;
}

export function getFixtureOrgId() {
  return org.id;
}
