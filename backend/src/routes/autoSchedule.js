import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScheduleAccess } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';

const router = Router();
router.use(requireAuth, auditContext);

// Assignments (and this auto-schedule generator) have no organization_id
// of their own — scope via the calendar. See routes/assignments.js for the
// identical helper.
async function scopeCalendarOrRespond(req, res, calendarId) {
  const { rows } = await pool.query('SELECT organization_id FROM calendars WHERE id = $1', [calendarId]);
  if (!rows[0]) {
    res.status(404).json({ error: 'Calendar not found' });
    return null;
  }
  const scopedIds = await resolveScopedOrgIds(req);
  if (!(scopedIds === null || scopedIds.includes(rows[0].organization_id))) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return null;
  }
  return rows[0].organization_id;
}

// Full scheduling reach: a person is only assignable to a calendar if it's
// their primary organization, or one of their additionally-linked
// organizations (person_organizations, routes/people.js). See
// routes/assignments.js for the identical helper.
async function findUnassignablePeople(personIds, calendarOrgId) {
  const ids = [...new Set(personIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT p.id, p.name FROM people p
     WHERE p.id = ANY($1)
       AND p.organization_id IS DISTINCT FROM $2
       AND NOT EXISTS (SELECT 1 FROM person_organizations po WHERE po.person_id = p.id AND po.organization_id = $2)`,
    [ids, calendarOrgId]
  );
  return rows;
}

const generateSchema = z.object({
  calendarId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  personIds: z.array(z.string().uuid()).min(1),
  rotationDays: z.number().int().min(1).default(7), // how often the primary rotates
});

function buildRotation(input) {
  const dates = [];
  let cursor = new Date(input.startDate);
  const end = new Date(input.endDate);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates.map((date, i) => {
    const rotationIndex = Math.floor(i / input.rotationDays) % input.personIds.length;
    return {
      date,
      startTime: input.startTime,
      endTime: input.endTime,
      primaryPersonId: input.personIds[rotationIndex],
      secondaryPersonId: input.personIds[(rotationIndex + 1) % input.personIds.length],
    };
  });
}

router.post('/preview', requireScheduleAccess, async (req, res) => {
  const input = generateSchema.parse(req.body);
  if (!(await scopeCalendarOrRespond(req, res, input.calendarId))) return;
  res.json({ preview: buildRotation(input) });
});

router.post('/commit', requireScheduleAccess, async (req, res) => {
  const input = generateSchema.parse(req.body);
  const calendarOrgId = await scopeCalendarOrRespond(req, res, input.calendarId);
  if (!calendarOrgId) return;

  const unassignable = await findUnassignablePeople(input.personIds, calendarOrgId);
  if (unassignable.length > 0) {
    return res.status(400).json({
      error: `Not assignable to this calendar's organization (add them to it under People first): ${unassignable.map((p) => p.name).join(', ')}`,
    });
  }

  const rotation = buildRotation(input);

  const created = [];
  for (const slot of rotation) {
    const { rows } = await pool.query(
      `INSERT INTO assignments (calendar_id, date, start_time, end_time, mode, primary_person_id, secondary_person_id, created_by)
       VALUES ($1, $2, $3, $4, 'escalation', $5, $6, $7) RETURNING *`,
      [input.calendarId, slot.date, slot.startTime, slot.endTime, slot.primaryPersonId, slot.secondaryPersonId, req.user.id]
    );
    created.push(rows[0]);
  }

  await req.logAudit({
    action: 'create',
    entityType: 'assignment',
    newValues: { autoScheduled: true, count: created.length, calendarId: input.calendarId },
  });
  res.status(201).json({ assignments: created });
});

export default router;
