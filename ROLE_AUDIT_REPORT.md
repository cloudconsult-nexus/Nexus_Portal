# Role Audit Report

**Status: cannot currently be regenerated — stale content removed
2026-08-19.**

This file is supposed to be a record of what `backend/tests/roleAudit.test.js`
and `frontend/tests/navVisibility.test.js` *actually observed* on their last
run (via `scripts/generate-role-docs.mjs` + `scripts/run-role-audit.sh`),
not a hand-typed claim. The version previously here was generated
**2026-07-23** — three days *before* the Phase 5.1 hierarchy/role flattening
(2026-07-26) — and reported results for the old 5-tier role model (Global
Admin / Organization Admin / Scheduler / Technician / Employee (Read Only)),
which no longer exists. Leaving those numbers in place would misrepresent a
system that hasn't existed for weeks as currently audited and passing;
better to say plainly that it isn't, until it can be regenerated for real.

**Why it can't be regenerated right now**: `backend/tests/roleAudit.test.js`
imports `./support/fixtures.js` and `./support/roleMatrix.js`, neither of
which exist in this repo — a pre-existing gap (see the comment in
`backend/tests/support/setupEnv.js`), not something introduced by this
update. Without those, the backend half of the audit suite fails to import
and never runs, so there's no fresh `backend/tests/results/backend-role-audit.json`
for the generator to read.

**To restore this file for real:**
1. Rebuild `backend/tests/support/fixtures.js` (`setupFixtures`,
   `teardownFixtures`, `tokenFor`, `personIdFor`, `getFixture`) and
   `backend/tests/support/roleMatrix.js` (`ROLES`, `ENDPOINT_CHECKS`,
   `READ_CHECKS`) for the current 3-role model — `ROLE_MATRIX.md`'s tables
   (also rewritten 2026-08-19, by hand, from the actual route files) are a
   reasonable starting point for what `ENDPOINT_CHECKS`/`READ_CHECKS` should
   assert.
2. Run `scripts/run-role-audit.sh` (or `npm test` in `backend/` and
   `frontend/` individually) to produce fresh result JSON.
3. Run `node scripts/generate-role-docs.mjs` to regenerate both this file
   and `ROLE_MATRIX.md` from that data.

Until then, treat `ROLE_MATRIX.md` as the accurate reference for what
*should* be enforced, and this file as unavailable rather than trust
whatever numbers might otherwise sit here.
