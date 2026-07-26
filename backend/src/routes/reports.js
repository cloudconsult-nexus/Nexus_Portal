import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { auditContext } from '../middleware/audit.js';
import { getDashboardAlerts } from '../lib/calendarService.js';
import { buildEmbedUrl } from '../lib/embedSso.js';

const router = Router();
router.use(requireAuth, auditContext);

router.get('/dashboard-summary', async (req, res) => {
  const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.query);

  const [orgCount, peopleCount, calendarCount, upcomingCount] = await Promise.all([
    pool.query(`SELECT count(*) FROM organizations WHERE is_deleted = false`),
    pool.query(`SELECT count(*) FROM people WHERE organization_id = $1 AND is_deleted = false`, [organizationId]),
    pool.query(`SELECT count(*) FROM calendars WHERE organization_id = $1`, [organizationId]),
    pool.query(
      `SELECT count(*) FROM assignments a JOIN calendars c ON c.id = a.calendar_id
       WHERE c.organization_id = $1 AND a.date >= CURRENT_DATE AND a.date < CURRENT_DATE + 7`,
      [organizationId]
    ),
  ]);

  const alerts = await getDashboardAlerts(organizationId);

  res.json({
    organizationCount: Number(orgCount.rows[0].count),
    peopleCount: Number(peopleCount.rows[0].count),
    calendarCount: Number(calendarCount.rows[0].count),
    upcomingAssignments: Number(upcomingCount.rows[0].count),
    alerts,
  });
});

router.get('/coverage', async (req, res) => {
  const { calendarId, startDate, endDate } = z
    .object({ calendarId: z.string().uuid(), startDate: z.string(), endDate: z.string() })
    .parse(req.query);

  const { rows } = await pool.query(
    `SELECT date, count(*) FILTER (WHERE primary_person_id IS NOT NULL) AS covered, count(*) AS total
     FROM assignments WHERE calendar_id = $1 AND date BETWEEN $2 AND $3
     GROUP BY date ORDER BY date`,
    [calendarId, startDate, endDate]
  );
  const totalSlots = rows.reduce((sum, r) => sum + Number(r.total), 0);
  const coveredSlots = rows.reduce((sum, r) => sum + Number(r.covered), 0);

  res.json({
    byDate: rows,
    coveragePercent: totalSlots === 0 ? null : Math.round((coveredSlots / totalSlots) * 100),
  });
});

router.get('/workload', async (req, res) => {
  const { organizationId, startDate, endDate } = z
    .object({ organizationId: z.string().uuid(), startDate: z.string(), endDate: z.string() })
    .parse(req.query);

  const { rows } = await pool.query(
    `SELECT p.id, p.name, count(a.id) AS shift_count
     FROM people p
     LEFT JOIN assignments a ON a.primary_person_id = p.id AND a.date BETWEEN $2 AND $3
     WHERE p.organization_id = $1 AND p.is_deleted = false
     GROUP BY p.id, p.name ORDER BY shift_count DESC`,
    [organizationId, startDate, endDate]
  );
  res.json({ workload: rows });
});

router.get('/mappings', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description, sort_order FROM report_mappings
     WHERE is_active = true AND $1 = ANY(visible_to_roles) ORDER BY sort_order`,
    [req.user.role]
  );
  res.json({ reports: rows });
});

router.get('/mappings/:id/embed', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM report_mappings WHERE id = $1 AND is_active = true', [req.params.id]);
  const mapping = rows[0];
  if (!mapping) return res.status(404).json({ error: 'Not found' });
  if (!mapping.visible_to_roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const embedUrl = buildEmbedUrl(mapping, { userId: req.user.id, role: req.user.role });
  await req.logAudit({ action: 'view', entityType: 'report_mapping', entityId: mapping.id, entityName: mapping.name });
  res.json({ embedUrl });
});

export default router;
