import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireApiKey } from '../middleware/serviceAuth.js';
import { getOnCallAt } from '../lib/calendarService.js';
import { PEOPLE_COLUMNS, withResolvedPhoto } from './people.js';

// NCC (Nextiva Contact Center)-facing endpoint — the inbound half of Phase
// 5.4 (CLAUDE.md "Target spec: TAS Client Portal"). NCC calls this live,
// mid-call/chat, to resolve who to dispatch a message to; it is not part
// of the human-facing app, so it's gated by a service API key
// (requireApiKey), not the human JWT session (middleware/auth.js's
// requireAuth) that every other route in this app uses. Mounted at the
// same '/organizations' prefix as routes/organizations.js (app.js) — no
// existing route conflicts, since Express only matches '/:id' against a
// single path segment and this is '/:id/on-call'.
//
// requireApiKey is applied directly on the one route below, NOT via
// `router.use(requireApiKey)` — this router shares the '/organizations'
// prefix with organizationsRoutes (app.js mounts both), and a bare
// `router.use()` middleware runs for every request that reaches this
// router regardless of which path it eventually matches, before Express
// even tries organizationsRoutes. With no NCC_API_KEY configured (true of
// every environment until Phase 5.4 secrets are provisioned — see
// .env.example), that took down GET/POST/PUT/DELETE /organizations/* —
// the entire Customers page — with a 500 "Service authentication is not
// configured", which is indistinguishable in the UI from "no customers
// exist". No data was ever touched; this is purely a routing bug.
// (Incident: 2026-08-19, see CLAUDE.md/RUNBOOK.md postmortem note.)
const router = Router();

const paramsSchema = z.object({ orgId: z.string().uuid() });
const querySchema = z.object({ at: z.string().datetime({ offset: true }) });

// GET /organizations/:orgId/on-call?at=<ISO8601 timestamp>
//
// Returns every on-call contact for the Customer at the given instant,
// tagged with on_call_role (primary/secondary/tertiary/default) and
// ordered primary → secondary → tertiary → default (default always last —
// see lib/calendarService.js#getOnCallAt for the full ordering/fallback
// contract, confirmed with the client 2026-08-18).
//
// Response shape reuses routes/people.js's existing people-list payload
// (PEOPLE_COLUMNS + withResolvedPhoto) plus the added on_call_role field,
// per CLAUDE.md's instruction to match the format already in use rather
// than invent a new one.
router.get('/:orgId/on-call', requireApiKey, async (req, res) => {
  const { orgId } = paramsSchema.parse(req.params);
  const { at } = querySchema.parse(req.query);

  const entries = await getOnCallAt(orgId, at);
  if (entries === null) return res.status(404).json({ error: 'Not found' });
  if (entries.length === 0) return res.json({ onCall: [] });

  const personIds = [...new Set(entries.map((e) => e.personId))];
  const { rows: people } = await pool.query(
    `SELECT ${PEOPLE_COLUMNS} FROM people WHERE id = ANY($1) AND is_deleted = false`,
    [personIds]
  );
  const byId = new Map(
    await Promise.all(people.map(async (p) => [p.id, await withResolvedPhoto(p)]))
  );

  // Zip role onto person BEFORE filtering out any since-deleted/deactivated
  // person a stale assignment still points at — filtering first would
  // desync entries[i] from the surviving people.
  const onCall = entries
    .map((e) => {
      const person = byId.get(e.personId);
      return person ? { ...person, on_call_role: e.onCallRole } : null;
    })
    .filter(Boolean);

  res.json({ onCall });
});

export default router;
