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
  primaryPersonId: z.string().uuid().nullable().optional(),
  secondaryPersonId: z.string().uuid().nullable().optional(),
  tertiaryPersonId: z.string().uuid().nullable().optional(),
  defaultPersonId: z.string().uuid().nullable().optional(),
  broadcastPool: z.array(z.string().uuid()).optional(),
  notes: z.string().optional(),
  notifySlack: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  replicateMonths: z.number().int().min(0).max(MAX_REPLICATION_MONTHS).optional(),
});

router.post('/', requireScheduleAccess, async (req, res) => {
  const input = createSchema.parse(req.body);
  if (!(await scopeCalendarOrRespond(req, res, input.calendarId))) return;

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

  const created = [];
  const conflicts = [];
  for (const date of dates) {
    if (input.primaryPersonId) {
      const found = await detectConflicts(input.primaryPersonId, date, input.startTime, input.endTime);
      if (found.length > 0) conflicts.push({ date, personId: input.primaryPersonId, conflictsWith: found });
    }

    const { rows } = await pool.query(
      `INSERT INTO assignments
         (calendar_id, date, start_time, end_time, mode, primary_person_id, secondary_person_id,
          tertiary_person_id, default_person_id, broadcast_pool, notes, notify_slack, notify_email, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        input.calendarId, date, input.startTime, input.endTime, input.mode,
        input.primaryPersonId || null, input.secondaryPersonId || null, input.tertiaryPersonId || null,
        input.defaultPersonId || null, input.broadcastPool || [], input.notes || null,
        input.notifySlack ?? true, input.notifyEmail ?? true, req.user.id,
      ]
    );
    created.push(rows[0]);
  }

  await req.logAudit({ action: 'create', entityType: 'assignment', entityId: created[0]?.id, newValues: { count: created.length } });
  res.status(201).json({ assignments: created, conflicts });
});

router.put('/:id', requireScheduleAccess, async (req, res) => {
  const { rows: existingRows } = await pool.query('SELECT * FROM assignments WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!(await scopeCalendarOrRespond(req, res, existing.calendar_id))) return;

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
      values.push(req.body[camel]);
    }
  }
  if (updates.length === 0) return res.json({ assignment: existing });

  if (req.body.primaryPersonId) {
    const conflicts = await detectConflicts(req.body.primaryPersonId, existing.date, existing.start_time, existing.end_time, existing.id);
    if (conflicts.length > 0) {
      return res.status(409).json({ error: 'Scheduling conflict detected', conflicts });
    }
  }

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE assignments SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );

  await req.logAudit({ action: 'update', entityType: 'assignment', entityId: req.params.id, oldValues: existing, newValues: rows[0] });
  res.json({ assignment: rows[0] });
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
