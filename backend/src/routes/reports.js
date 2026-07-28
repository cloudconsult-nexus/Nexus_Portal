import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { auditContext } from '../middleware/audit.js';
import { getDashboardAlerts } from '../lib/calendarService.js';
import { buildEmbedUrl } from '../lib/embedSso.js';
import { resolveScopedOrgIds, getDescendantIds } from '../lib/orgScope.js';

const router = Router();
router.use(requireAuth, auditContext);

router.get('/dashboard-summary', async (req, res) => {
  const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.query);

  // Previously trusted organizationId with no ownership check at all — a
  // Customer Admin could view any Customer's dashboard stats by changing
  // this query param. Now validated against the caller's resolved scope,
  // and the stats themselves cover organizationId + its descendants
  // ("this level and down"), not just the one org.
  const scopedIds = await resolveScopedOrgIds(req);
  if (!(scopedIds === null || scopedIds.includes(organizationId))) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const subtreeIds = [organizationId, ...(await getDescendantIds(organizationId))];

  const [orgCount, peopleCount, calendarCount, upcomingCount] = await Promise.all([
    pool.query(`SELECT count(*) FROM organizations WHERE is_deleted = false AND id = ANY($1)`, [subtreeIds]),
    pool.query(`SELECT count(*) FROM people WHERE organization_id = ANY($1) AND is_deleted = false`, [subtreeIds]),
    pool.query(`SELECT count(*) FROM calendars WHERE organization_id = ANY($1)`, [subtreeIds]),
    pool.query(
      `SELECT count(*) FROM assignments a JOIN calendars c ON c.id = a.calendar_id
       WHERE c.organization_id = ANY($1) AND a.date >= CURRENT_DATE AND a.date < CURRENT_DATE + 7`,
      [subtreeIds]
    ),
  ]);

  // getDashboardAlerts is still single-org (not subtree-aware) — a smaller,
  // separate change if alerts need to roll up across descendants too.
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

  const { rows: calRows } = await pool.query('SELECT organization_id FROM calendars WHERE id = $1', [calendarId]);
  if (!calRows[0]) return res.status(404).json({ error: 'Calendar not found' });
  const scopedIds = await resolveScopedOrgIds(req);
  if (!(scopedIds === null || scopedIds.includes(calRows[0].organization_id))) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

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

  const scopedIds = await resolveScopedOrgIds(req);
  if (!(scopedIds === null || scopedIds.includes(organizationId))) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const subtreeIds = [organizationId, ...(await getDescendantIds(organizationId))];

  const { rows } = await pool.query(
    `SELECT p.id, p.name, count(a.id) AS shift_count
     FROM people p
     LEFT JOIN assignments a ON a.primary_person_id = p.id AND a.date BETWEEN $2 AND $3
     WHERE p.organization_id = ANY($1) AND p.is_deleted = false
     GROUP BY p.id, p.name ORDER BY shift_count DESC`,
    [subtreeIds, startDate, endDate]
  );
  res.json({ workload: rows });
});

// Per-child breakdown for a parent Customer: one row per organization in
// its subtree (itself + every descendant) with that org's OWN direct
// numbers — not recursively rolled into each other — plus a `total` row
// summing them, so a parent can be compared against its children rather
// than only seeing one already-merged figure (that's what /workload and
// /dashboard-summary already do).
router.get('/hierarchy-summary', async (req, res) => {
  const { organizationId, startDate, endDate } = z
    .object({ organizationId: z.string().uuid(), startDate: z.string(), endDate: z.string() })
    .parse(req.query);

  const scopedIds = await resolveScopedOrgIds(req);
  if (!(scopedIds === null || scopedIds.includes(organizationId))) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  const subtreeIds = [organizationId, ...(await getDescendantIds(organizationId))];

  const [orgRows, peopleRows, calendarRows, upcomingRows, gapRows, missingRows] = await Promise.all([
    pool.query(`SELECT id, name, account_number FROM organizations WHERE id = ANY($1) AND is_deleted = false ORDER BY name`, [subtreeIds]),
    pool.query(`SELECT organization_id, count(*) AS n FROM people WHERE organization_id = ANY($1) AND is_deleted = false GROUP BY organization_id`, [subtreeIds]),
    pool.query(`SELECT organization_id, count(*) AS n FROM calendars WHERE organization_id = ANY($1) GROUP BY organization_id`, [subtreeIds]),
    pool.query(
      `SELECT c.organization_id, count(*) AS n FROM assignments a JOIN calendars c ON c.id = a.calendar_id
       WHERE c.organization_id = ANY($1) AND a.date BETWEEN $2 AND $3
       GROUP BY c.organization_id`,
      [subtreeIds, startDate, endDate]
    ),
    pool.query(
      `SELECT c.organization_id, count(*) AS n FROM assignments a JOIN calendars c ON c.id = a.calendar_id
       WHERE c.organization_id = ANY($1) AND a.date BETWEEN $2 AND $3
         AND a.mode = 'escalation' AND a.primary_person_id IS NULL
       GROUP BY c.organization_id`,
      [subtreeIds, startDate, endDate]
    ),
    pool.query(
      `SELECT c.organization_id, count(*) AS n FROM assignments a JOIN calendars c ON c.id = a.calendar_id
       WHERE c.organization_id = ANY($1) AND a.date BETWEEN $2 AND $3
         AND a.mode = 'escalation' AND a.primary_person_id IS NOT NULL
         AND a.secondary_person_id IS NULL AND a.default_person_id IS NULL
       GROUP BY c.organization_id`,
      [subtreeIds, startDate, endDate]
    ),
  ]);

  const toCountMap = (rows) => new Map(rows.map((r) => [r.organization_id, Number(r.n)]));
  const peopleMap = toCountMap(peopleRows.rows);
  const calendarMap = toCountMap(calendarRows.rows);
  const upcomingMap = toCountMap(upcomingRows.rows);
  const gapMap = toCountMap(gapRows.rows);
  const missingMap = toCountMap(missingRows.rows);

  const rows = orgRows.rows
    .map((o) => ({
      organizationId: o.id,
      organizationName: o.name,
      accountNumber: o.account_number,
      isRoot: o.id === organizationId,
      peopleCount: peopleMap.get(o.id) || 0,
      calendarCount: calendarMap.get(o.id) || 0,
      upcomingAssignments: upcomingMap.get(o.id) || 0,
      coverageGaps: gapMap.get(o.id) || 0,
      missingEscalationChains: missingMap.get(o.id) || 0,
    }))
    .sort((a, b) => (a.isRoot === b.isRoot ? a.organizationName.localeCompare(b.organizationName) : a.isRoot ? -1 : 1));

  const total = rows.reduce(
    (acc, r) => ({
      peopleCount: acc.peopleCount + r.peopleCount,
      calendarCount: acc.calendarCount + r.calendarCount,
      upcomingAssignments: acc.upcomingAssignments + r.upcomingAssignments,
      coverageGaps: acc.coverageGaps + r.coverageGaps,
      missingEscalationChains: acc.missingEscalationChains + r.missingEscalationChains,
    }),
    { peopleCount: 0, calendarCount: 0, upcomingAssignments: 0, coverageGaps: 0, missingEscalationChains: 0 }
  );

  res.json({ rows, total });
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
