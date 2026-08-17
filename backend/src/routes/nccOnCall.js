import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireNccAuth } from '../lib/nccAuth.js';
import { resolveLocalDateTime } from '../lib/localTime.js';
import { logAction } from '../lib/auditService.js';

// NCC (Nextiva Contact Center, built on Thrio) calling *into* this Portal
// during a live inbound call/chat to resolve who's on call for a Customer
// ("campaign" on NCC's side, mapped 1:1 to an organizations row here) at a
// given moment. Kept in its own router rather than added to
// routes/organizations.js — that router does `router.use(requireAuth,
// auditContext)` at the top, which assumes a logged-in person; NCC has
// neither.
//
// Mounted at its own '/ncc' prefix in app.js, not reusing '/organizations'
// — a router's top-level `.use(middleware)` (no path) runs for *every*
// request under its mount prefix, not just ones that match one of its own
// routes, so mounting a second router at the identical '/organizations'
// prefix doesn't "fall through" to it when organizationsRoutes' own
// '/:id' pattern fails to match a longer path like '/:id/on-call' — its
// requireAuth still runs first and 401s before Express ever gets to try
// the second router. (Found this the hard way: a supertest request with
// no Authorization header at all initially came back 401 "Missing or
// invalid Authorization header" — requireAuth's exact message, not this
// file's — even with NCC_API_KEY deliberately unset, which should have
// hit the 501 branch below instead.) A distinct prefix sidesteps the
// whole problem, same reasoning routes/publicBranding.js already applies
// for its own separate mount point.
const router = Router();
router.use(requireNccAuth);

const PERSON_COLUMNS = 'id, name, email, primary_phone, sms_phone';

// primary_person_id and default_person_id are both mandatory on every
// escalation-mode assignment row (routes/assignments.js's createSchema —
// only secondary/tertiary are optional), so an active row always yields at
// least these two roles. There's no org/calendar-level fallback contact
// independent of an actual scheduled row in today's schema — see the plan
// discussion this endpoint was built against.
const ROLE_ORDER = ['primary', 'secondary', 'tertiary', 'default'];
const ROLE_COLUMN = {
  primary: 'primary_person_id',
  secondary: 'secondary_person_id',
  tertiary: 'tertiary_person_id',
  default: 'default_person_id',
};

const querySchema = z.object({
  at: z.string().min(1).refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid timestamp'),
});

router.get('/organizations/:id/on-call', async (req, res) => {
  const { id: organizationId } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { at } = querySchema.parse(req.query);

  const { rows: orgRows } = await pool.query(
    'SELECT id FROM organizations WHERE id = $1 AND is_deleted = false',
    [organizationId]
  );
  if (!orgRows[0]) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  const { rows: settingsRows } = await pool.query('SELECT timezone FROM tas_settings LIMIT 1');
  const timezone = settingsRows[0]?.timezone || 'UTC';

  let date, time;
  try {
    ({ date, time } = resolveLocalDateTime(at, timezone));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { rows: calendarRows } = await pool.query(
    'SELECT id FROM calendars WHERE organization_id = $1',
    [organizationId]
  );
  const calendarIds = calendarRows.map((c) => c.id);

  await logAction({
    userId: null,
    userEmail: 'ncc-integration',
    action: 'view',
    entityType: 'organization',
    entityId: organizationId,
    entityName: 'NCC on-call lookup',
    organizationId,
    newValues: { at, resolvedDate: date, resolvedTime: time, timezone },
  });

  if (calendarIds.length === 0) {
    return res.json({ organizationId, at, onCall: [], coverageGap: true });
  }

  // One row per staffed calendar active at this moment — merged across
  // every calendar the org has (an org with two calendars both staffed at
  // this instant returns tiers from both, not just one).
  //
  // Same overlap style as routes/assignments.js's own conflict-detection
  // query (start_time <= X AND end_time > X) — deliberately not adding
  // different handling for a shift that crosses midnight (e.g. 22:00–06:00
  // stored as plain TIME values breaks a naive "between" check either
  // way); that's a pre-existing gap shared with the rest of the scheduling
  // code, not something new to this endpoint.
  const { rows: assignmentRows } = await pool.query(
    `SELECT * FROM assignments
     WHERE calendar_id = ANY($1) AND mode = 'escalation'
       AND date = $2 AND start_time <= $3 AND end_time > $3`,
    [calendarIds, date, time]
  );

  if (assignmentRows.length === 0) {
    return res.json({ organizationId, at, onCall: [], coverageGap: true });
  }

  const personIds = new Set();
  const tagged = []; // { role, personId } in role order, per assignment row
  for (const role of ROLE_ORDER) {
    for (const assignment of assignmentRows) {
      const personId = assignment[ROLE_COLUMN[role]];
      if (personId) {
        tagged.push({ role, personId });
        personIds.add(personId);
      }
    }
  }

  const { rows: peopleRows } = await pool.query(
    `SELECT ${PERSON_COLUMNS} FROM people WHERE id = ANY($1) AND is_deleted = false`,
    [[...personIds]]
  );
  const peopleById = new Map(peopleRows.map((p) => [p.id, p]));

  const onCall = tagged
    .map(({ role, personId }) => {
      const person = peopleById.get(personId);
      if (!person) return null; // deleted since the shift was scheduled
      const { id, ...personFields } = person;
      return { role, ...personFields };
    })
    .filter(Boolean);

  res.json({ organizationId, at, onCall });
});

export default router;
