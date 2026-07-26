import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScheduleAccess } from '../middleware/rbac.js';
import { auditContext } from '../middleware/audit.js';

const router = Router();
router.use(requireAuth, auditContext);

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
  res.json({ preview: buildRotation(input) });
});

router.post('/commit', requireScheduleAccess, async (req, res) => {
  const input = generateSchema.parse(req.body);
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
