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

// Each rule is its own day-of-week-scoped rotation (e.g. "after hours
// Mon-Thu" with one on-call pool, "weekends" with another) so a scheduler
// can combine several coverage patterns in one generation instead of only
// ever rotating the same pool across every calendar day.
const ruleSchema = z.object({
  label: z.string().trim().max(60).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1), // 0 = Sunday … 6 = Saturday
  startTime: z.string(),
  endTime: z.string(),
  personIds: z.array(z.string().uuid()).min(1),
  rotationDays: z.number().int().min(1).default(7), // how often the primary rotates, counted in shifts this rule actually generates
});

const generateSchema = z
  .object({
    calendarId: z.string().uuid(),
    startDate: z.string(),
    endDate: z.string(),
    rules: z.array(ruleSchema).min(1),
  })
  .superRefine((data, ctx) => {
    // Rules are meant to partition the week (weekdays vs. weekends, etc.) —
    // a day claimed by two rules would silently double-book that date, so
    // reject it up front instead of generating a hidden conflict.
    const claimedBy = new Map();
    data.rules.forEach((rule, ruleIndex) => {
      rule.daysOfWeek.forEach((day) => {
        if (claimedBy.has(day)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Day ${day} is selected in both rule ${claimedBy.get(day) + 1} and rule ${ruleIndex + 1} — each day can only belong to one rule`,
            path: ['rules', ruleIndex, 'daysOfWeek'],
          });
        } else {
          claimedBy.set(day, ruleIndex);
        }
      });
    });
  });

function buildRotation(input) {
  const matchCounts = input.rules.map(() => 0);
  const slots = [];
  let cursor = new Date(input.startDate);
  const end = new Date(input.endDate);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    // getUTCDay(), not getDay() — the date label above comes from
    // toISOString() (UTC), so day-of-week must be read the same way or it
    // drifts by one day whenever the server's local timezone isn't UTC.
    const dayOfWeek = cursor.getUTCDay();
    input.rules.forEach((rule, ruleIndex) => {
      if (!rule.daysOfWeek.includes(dayOfWeek)) return;
      const matchIndex = matchCounts[ruleIndex];
      const rotationIndex = Math.floor(matchIndex / rule.rotationDays) % rule.personIds.length;
      slots.push({
        date,
        startTime: rule.startTime,
        endTime: rule.endTime,
        primaryPersonId: rule.personIds[rotationIndex],
        secondaryPersonId: rule.personIds[(rotationIndex + 1) % rule.personIds.length],
        ruleLabel: rule.label || null,
      });
      matchCounts[ruleIndex] = matchIndex + 1;
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
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

  const allPersonIds = input.rules.flatMap((rule) => rule.personIds);
  const unassignable = await findUnassignablePeople(allPersonIds, calendarOrgId);
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
    newValues: { autoScheduled: true, count: created.length, calendarId: input.calendarId, ruleCount: input.rules.length },
  });
  res.status(201).json({ assignments: created });
});

export default router;
