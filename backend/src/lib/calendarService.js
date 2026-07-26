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
