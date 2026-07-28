import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScheduleAccess } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';
import { detectConflicts } from '../lib/calendarService.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';

const router = Router();
router.use(requireAuth, auditContext);

const MAX_REPLICATION_MONTHS = 36;

// The frontend's person selects use '' for "— None —" (a plain HTML <select>
// has no null option value) — coerce that to null before it ever reaches
// zod's .uuid() check or a query parameter, otherwise an unset Secondary/
// Tertiary tier throws instead of validating as "not set".
function emptyToNull(v) {
  return v === '' ? null : v;
}
const PERSON_TIER_FIELDS = new Set(['primary_person_id', 'secondary_person_id', 'tertiary_person_id', 'default_person_id']);

// Assignments have no organization_id of their own — scope via the
// calendar they belong to. Returns the calendar's organization_id (for
// audit/other use) or null + sends the response itself if not found/
// out of scope, so callers can `if (!orgId) return;`.
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

router.get('/', async (req, res) => {
  const { calendarId, startDate, endDate } = z
    .object({ calendarId: z.string().uuid(), startDate: z.string(), endDate: z.string() })
    .parse(req.query);

  if (!(await scopeCalendarOrRespond(req, res, calendarId))) return;

  const { rows } = await pool.query(
    `SELECT * FROM assignments WHERE calendar_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date, start_time`,
    [calendarId, startDate, endDate]
  );
  res.json({ assignments: rows });
});

const createSchema = z.object({
  calendarId: z.string().uuid(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  mode: z.enum(['escalation', 'broadcast']).default('escalation'),
  // Primary and Default are the only mandatory tiers for scheduling — they
  // may point at the same person. Secondary/Tertiary stay optional for both
  // modes (escalation uses them for sequential timeout-based escalation;
  // broadcast uses whichever are set as additional simultaneous pool members).
  primaryPersonId: z.preprocess(emptyToNull, z.string().uuid()),
  defaultPersonId: z.preprocess(emptyToNull, z.string().uuid()),
  secondaryPersonId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  tertiaryPersonId: z.preprocess(emptyToNull, z.string().uuid().nullable().optional()),
  broadcastPool: z.array(z.string().uuid()).optional(),
  notes: z.string().optional(),
  notifySlack: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  replicateMonths: z.number().int().min(0).max(MAX_REPLICATION_MONTHS).optional(),
  // When a prior attempt came back with requiresConfirmation, resubmitting
  // with this set to true is the scheduler's explicit approval to create the
  // assignment anyway, double-booking the conflicting person(s) on purpose.
  confirmConflicts: z.boolean().optional(),
});

// Full scheduling reach: a person is only assignable to a calendar if it's
// their primary organization, or one of their additionally-linked
// organizations (person_organizations, routes/people.js). Returns whichever
// of the submitted people belong to neither, so the caller can reject with
// a specific, actionable error instead of a silent mismatch.
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

// Checks every filled tier (primary/secondary/tertiary/default) for a given
// shift window against the rest of the schedule, tagging each hit with which
// tier it came from. A person can legitimately fill more than one tier (e.g.
// primary === default), so results are cached per person to avoid redundant
// lookups and duplicate conflict entries.
async function findAllConflicts(tiers, date, startTime, endTime, excludeAssignmentId) {
  const entries = [
    ['primary', tiers.primaryPersonId],
    ['secondary', tiers.secondaryPersonId],
    ['tertiary', tiers.tertiaryPersonId],
    ['default', tiers.defaultPersonId],
  ].filter(([, id]) => id);

  const cache = new Map();
  const results = [];
  for (const [tier, personId] of entries) {
    if (!cache.has(personId)) {
      cache.set(personId, await detectConflicts(personId, date, startTime, endTime, excludeAssignmentId));
    }
    const conflictsWith = cache.get(personId);
    if (conflictsWith.length > 0) results.push({ tier, personId, date, conflictsWith });
  }
  return results;
}

router.post('/', requireScheduleAccess, async (req, res) => {
  const input = createSchema.parse(req.body);
  const calendarOrgId = await scopeCalendarOrRespond(req, res, input.calendarId);
  if (!calendarOrgId) return;

  const dates = [input.date];
  if (input.replicateMonths) {
    const start = new Date(input.date);
    const end = new Date(start);
    end.setMonth(end.getMonth() + input.replicateMonths);
    let cursor = new Date(start);
    cursor.setDate(cursor.getDate() + 7); // weekly replication of the same slot
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 7);
    }
  }

  const tiers = {
    primaryPersonId: input.primaryPersonId,
    secondaryPersonId: input.secondaryPersonId || null,
    tertiaryPersonId: input.tertiaryPersonId || null,
    defaultPersonId: input.defaultPersonId,
  };

  const unassignable = await findUnassignablePeople(
    [tiers.primaryPersonId, tiers.secondaryPersonId, tiers.tertiaryPersonId, tiers.defaultPersonId],
    calendarOrgId
  );
  if (unassignable.length > 0) {
    return res.status(400).json({
      error: `Not assignable to this calendar's organization (add them to it under People first): ${unassignable.map((p) => p.name).join(', ')}`,
    });
  }

  // A resource CAN legitimately be scheduled across multiple calendars or
  // overlapping shifts — this never blocks creation. It only requires the
  // scheduler to explicitly see and approve the conflict first (a second
  // submission with confirmConflicts: true) rather than silently allowing it.
  const allConflicts = [];
  for (const date of dates) {
    allConflicts.push(...(await findAllConflicts(tiers, date, input.startTime, input.endTime)));
  }
  if (allConflicts.length > 0 && !input.confirmConflicts) {
    return res.json({ requiresConfirmation: true, conflicts: allConflicts });
  }

  // Broadcast mode reuses the same primary/secondary/tertiary tiers as the
  // pool of people offered the shift simultaneously (unless an explicit pool
  // was passed) so both modes share one set of person fields.
  const broadcastPool = input.mode === 'broadcast'
    ? (input.broadcastPool?.length ? input.broadcastPool
        : [tiers.primaryPersonId, tiers.secondaryPersonId, tiers.tertiaryPersonId].filter(Boolean))
    : [];

  const created = [];
  for (const date of dates) {
    const { rows } = await pool.query(
      `INSERT INTO assignments
         (calendar_id, date, start_time, end_time, mode, primary_person_id, secondary_person_id,
          tertiary_person_id, default_person_id, broadcast_pool, notes, notify_slack, notify_email, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        input.calendarId, date, input.startTime, input.endTime, input.mode,
        tiers.primaryPersonId, tiers.secondaryPersonId, tiers.tertiaryPersonId,
        tiers.defaultPersonId, broadcastPool, input.notes || null,
        input.notifySlack ?? true, input.notifyEmail ?? true, req.user.id,
      ]
    );
    created.push(rows[0]);
  }

  await req.logAudit({ action: 'create', entityType: 'assignment', entityId: created[0]?.id, newValues: { count: created.length } });
  res.status(201).json({ assignments: created, conflicts: allConflicts });
});

router.put('/:id', requireScheduleAccess, async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const calendarOrgId = await scopeCalendarOrRespond(req, res, existing.calendar_id);
  if (!calendarOrgId) return;

  if (new Date(existing.date) < startOfToday()) {
    return res.status(400).json({ error: 'Past assignments are read-only' });
  }

  // Date/time are locked on edit — only the assigned people, notes, and
  // notification flags can change. Rescheduling means delete + recreate.
  const fields = ['primary_person_id', 'secondary_person_id', 'tertiary_person_id', 'default_person_id', 'notes', 'notify_slack', 'notify_email'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const field of fields) {
    const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (req.body[camel] !== undefined) {
      updates.push(`${field} = $${i++}`);
      values.push(PERSON_TIER_FIELDS.has(field) ? emptyToNull(req.body[camel]) : req.body[camel]);
    }
  }
  if (updates.length === 0) return res.json({ assignment: existing });

  const mergedTiers = {
    primaryPersonId: req.body.primaryPersonId !== undefined ? emptyToNull(req.body.primaryPersonId) : existing.primary_person_id,
    secondaryPersonId: req.body.secondaryPersonId !== undefined ? emptyToNull(req.body.secondaryPersonId) : existing.secondary_person_id,
    tertiaryPersonId: req.body.tertiaryPersonId !== undefined ? emptyToNull(req.body.tertiaryPersonId) : existing.tertiary_person_id,
    defaultPersonId: req.body.defaultPersonId !== undefined ? emptyToNull(req.body.defaultPersonId) : existing.default_person_id,
  };
  if (!mergedTiers.primaryPersonId || !mergedTiers.defaultPersonId) {
    return res.status(400).json({ error: 'Primary and Default person are required.' });
  }

  // Same symmetric policy as create: overlapping/multi-calendar bookings are
  // allowed, never hard-blocked — they just require the scheduler to
  // explicitly confirm once shown the conflict.
  const tierFieldsChanged = ['primaryPersonId', 'secondaryPersonId', 'tertiaryPersonId', 'defaultPersonId']
    .some((f) => req.body[f] !== undefined);
  let conflicts = [];
  if (tierFieldsChanged) {
    const unassignable = await findUnassignablePeople(
      [mergedTiers.primaryPersonId, mergedTiers.secondaryPersonId, mergedTiers.tertiaryPersonId, mergedTiers.defaultPersonId],
      calendarOrgId
    );
    if (unassignable.length > 0) {
      return res.status(400).json({
        error: `Not assignable to this calendar's organization (add them to it under People first): ${unassignable.map((p) => p.name).join(', ')}`,
      });
    }

    conflicts = await findAllConflicts(mergedTiers, existing.date, existing.start_time, existing.end_time, existing.id);
    if (conflicts.length > 0 && !req.body.confirmConflicts) {
      return res.json({ requiresConfirmation: true, conflicts });
    }
  }

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE assignments SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );

  await req.logAudit({ action: 'update', entityType: 'assignment', entityId: req.params.id, oldValues: existing, newValues: rows[0] });
  res.json({ assignment: rows[0], conflicts });
});

router.delete('/:id', requireScheduleAccess, async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await scopeCalendarOrRespond(req, res, existing.calendar_id))) return;
  if (new Date(existing.date) < startOfToday()) {
    return res.status(400).json({ error: 'Past assignments are read-only' });
  }

  await pool.query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
  await req.logAudit({ action: 'delete', entityType: 'assignment', entityId: req.params.id, oldValues: existing });
  res.status(204).end();
});

router.post('/copy', requireScheduleAccess, async (req, res) => {
  const input = z
    .object({
      calendarId: z.string().uuid(),
      sourceStartDate: z.string(),
      sourceEndDate: z.string(),
      targetStartDate: z.string(),
    })
    .parse(req.body);
  if (!(await scopeCalendarOrRespond(req, res, input.calendarId))) return;

  const { rows: sourceRows } = await pool.query(
    `SELECT * FROM assignments WHERE calendar_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
    [input.calendarId, input.sourceStartDate, input.sourceEndDate]
  );
  if (sourceRows.length === 0) return res.json({ assignments: [] });

  const dayOffset = daysBetween(input.sourceStartDate, input.targetStartDate);
  const created = [];
  for (const src of sourceRows) {
    const newDate = addDays(src.date, dayOffset);
    if (new Date(newDate) < startOfToday()) continue; // never overwrite the past

    const { rows } = await pool.query(
      `INSERT INTO assignments
         (calendar_id, date, start_time, end_time, mode, primary_person_id, secondary_person_id,
          tertiary_person_id, default_person_id, broadcast_pool, notes, notify_slack, notify_email, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        src.calendar_id, newDate, src.start_time, src.end_time, src.mode,
        src.primary_person_id, src.secondary_person_id, src.tertiary_person_id, src.default_person_id,
        src.broadcast_pool, src.notes, src.notify_slack, src.notify_email, req.user.id,
      ]
    );
    created.push(rows[0]);
  }

  await req.logAudit({ action: 'create', entityType: 'assignment', newValues: { copiedCount: created.length, from: input.sourceStartDate, to: input.targetStartDate } });
  res.status(201).json({ assignments: created });
});

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default router;
