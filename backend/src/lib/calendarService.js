import pool from '../db/pool.js';

// Cross-calendar conflict detection for multi-org providers (CLAUDE.md Phase
// 3/4): a Person can be linked to multiple organizations, so "is this
// person already on call at this time" has to check every calendar they're
// assigned to, not just the one being edited.
export async function detectConflicts(personId, date, startTime, endTime, excludeAssignmentId = null) {
  const { rows } = await pool.query(
    `SELECT a.id, a.calendar_id, a.date, a.start_time, a.end_time, c.name AS calendar_name
     FROM assignments a
     JOIN calendars c ON c.id = a.calendar_id
     WHERE a.date = $1
       AND (a.primary_person_id = $2 OR a.secondary_person_id = $2 OR a.tertiary_person_id = $2
            OR a.default_person_id = $2 OR $2 = ANY(a.broadcast_pool))
       AND a.start_time < $4 AND a.end_time > $3
       AND ($5::uuid IS NULL OR a.id != $5)`,
    [date, personId, startTime, endTime, excludeAssignmentId]
  );
  return rows;
}

// Dashboard alerts (README's "coverage gaps, unassigned shifts, conflicted
// users, missing escalation chains").
export async function getDashboardAlerts(organizationId) {
  const [unassigned, missingEscalation, conflicted] = await Promise.all([
    pool.query(
      `SELECT a.id, a.calendar_id, a.date, c.name AS calendar_name
       FROM assignments a
       JOIN calendars c ON c.id = a.calendar_id
       WHERE c.organization_id = $1 AND a.date >= CURRENT_DATE
         AND a.mode = 'escalation' AND a.primary_person_id IS NULL`,
      [organizationId]
    ),
    pool.query(
      `SELECT a.id, a.calendar_id, a.date, c.name AS calendar_name
       FROM assignments a
       JOIN calendars c ON c.id = a.calendar_id
       WHERE c.organization_id = $1 AND a.date >= CURRENT_DATE
         AND a.mode = 'escalation' AND a.primary_person_id IS NOT NULL
         AND a.secondary_person_id IS NULL AND a.default_person_id IS NULL`,
      [organizationId]
    ),
    pool.query(
      `SELECT a1.id AS assignment_id, a1.primary_person_id AS person_id, a1.date
       FROM assignments a1
       JOIN calendars c1 ON c1.id = a1.calendar_id
       WHERE c1.organization_id = $1 AND a1.date >= CURRENT_DATE
         AND EXISTS (
           SELECT 1 FROM assignments a2
           WHERE a2.id != a1.id AND a2.date = a1.date
             AND a2.start_time < a1.end_time AND a2.end_time > a1.start_time
             AND (a2.primary_person_id = a1.primary_person_id
                  OR a2.secondary_person_id = a1.primary_person_id)
         )`,
      [organizationId]
    ),
  ]);

  return {
    coverageGaps: unassigned.rows,
    missingEscalationChains: missingEscalation.rows,
    conflictedUsers: conflicted.rows,
  };
}

// True if Intl recognizes tz as an IANA timezone name — used to validate
// organizations.timezone on write (routes/organizations.js) before it can
// ever reach toLocalDateAndTime below and throw at query time instead.
export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Converts a UTC instant into a Customer's local calendar date + time of
// day, per its configured IANA timezone (organizations.timezone,
// migrations/017_ncc_oncall_lookup.sql).
function toLocalDateAndTime(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

const ON_CALL_ROLE_RANK = { primary: 0, secondary: 1, tertiary: 2, default: 3 };

// Resolves who's on call for a Customer at a specific instant — the query
// behind the NCC-facing endpoint (routes/onCall.js, CLAUDE.md Phase 5.4).
// A different question from detectConflicts/getDashboardAlerts above (those
// ask "is there a gap/conflict over a date range"); this asks "who, right
// now, for this one moment."
//
// Resolved per-calendar, then merged: a Customer can have more than one
// calendar (multi-org providers, multiple queues/campaigns), and NCC's
// query is Customer-scoped, not calendar-scoped, so every one of the
// Customer's calendars is checked and the results combined into one list.
//
// Ordering/fallback contract (confirmed with the client 2026-08-18):
//   - primary, then secondary, then tertiary, then default — always in
//     that order across the WHOLE merged list, not just within one
//     calendar's own entries.
//   - the per-slot default (assignments.default_person_id) is always
//     included when set, even alongside a full primary/secondary/tertiary
//     chain — it is not only a fallback for a missing chain.
//   - when NO assignment row covers the instant at all for a calendar (a
//     full coverage gap, not just a partial chain), that calendar's own
//     standing default (calendars.default_person_id) is used instead, so
//     the response is never empty for a calendar that has one configured.
//   - broadcast-mode assignments are excluded entirely — there is no
//     primary/secondary/tertiary/default distinction to tag pool members
//     with.
//
// Returns null if the organization doesn't exist/is deleted (the route
// turns that into a 404); otherwise an array of
// { personId, onCallRole, calendarId } in final response order. The same
// person filling the same role via more than one calendar is collapsed;
// the same person under two DIFFERENT roles is kept as two entries — that
// distinction is real signal for NCC, not noise.
export async function getOnCallAt(organizationId, atISO) {
  const { rows: orgRows } = await pool.query(
    `SELECT id, timezone FROM organizations WHERE id = $1 AND is_deleted = false`,
    [organizationId]
  );
  if (!orgRows[0]) return null;

  const instant = new Date(atISO);
  const { date, time } = toLocalDateAndTime(instant, orgRows[0].timezone);

  const { rows: calendars } = await pool.query(
    `SELECT id, default_person_id FROM calendars WHERE organization_id = $1`,
    [organizationId]
  );

  const entries = [];
  for (const calendar of calendars) {
    const { rows: assignmentRows } = await pool.query(
      `SELECT primary_person_id, secondary_person_id, tertiary_person_id, default_person_id
       FROM assignments
       WHERE calendar_id = $1 AND date = $2 AND mode = 'escalation'
         AND start_time <= $3 AND end_time > $3
       ORDER BY start_time LIMIT 1`,
      [calendar.id, date, time]
    );
    const assignment = assignmentRows[0];

    if (assignment) {
      for (const [personId, onCallRole] of [
        [assignment.primary_person_id, 'primary'],
        [assignment.secondary_person_id, 'secondary'],
        [assignment.tertiary_person_id, 'tertiary'],
        [assignment.default_person_id, 'default'],
      ]) {
        if (personId) entries.push({ personId, onCallRole, calendarId: calendar.id });
      }
    } else if (calendar.default_person_id) {
      entries.push({ personId: calendar.default_person_id, onCallRole: 'default', calendarId: calendar.id });
    }
  }

  // Stable sort: preserves each calendar's own primary→…→default order,
  // just interleaves calendars by role rank so "default always last" holds
  // across the merged list, not just within one calendar's own entries.
  entries.sort((a, b) => ON_CALL_ROLE_RANK[a.onCallRole] - ON_CALL_ROLE_RANK[b.onCallRole]);

  const seen = new Set();
  return entries.filter((e) => {
    const key = `${e.personId}:${e.onCallRole}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
