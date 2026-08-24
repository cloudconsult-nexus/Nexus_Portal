import { Router } from 'express';
import { z } from 'zod';
import pool from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireApiKey } from '../middleware/serviceAuth.js';
import { getOnCallAt } from '../lib/calendarService.js';
import { PEOPLE_COLUMNS, withResolvedPhoto } from './people.js';
import { resolveScopedOrgIds } from '../lib/orgScope.js';

// NCC (Nextiva Contact Center)-facing endpoint — the inbound half of Phase
// 5.4 (CLAUDE.md "Target spec: TAS Client Portal"). NCC calls this live,
// mid-call/chat, to resolve who to dispatch a message to. It is not
// exclusively part of the human-facing app, so it also accepts the human
// JWT session (middleware/auth.js's requireAuth) that every other route in
// this app uses — added so the Portal UI itself can reuse this same lookup
// (e.g. an in-app "who's on call right now" view) instead of duplicating
// getOnCallAt's merge/ordering logic behind a second endpoint. The
// service API key (requireApiKey) remains the path for NCC itself, which
// has no Person record to authenticate as. Mounted at the same
// '/organizations' prefix as routes/organizations.js (app.js) — no
// existing route conflicts, since Express only matches '/:id' against a
// single path segment and this is '/:id/on-call'.
//
// requireAuthOrApiKey is applied directly on the one route below, NOT via
// `router.use(...)` — this router shares the '/organizations' prefix with
// organizationsRoutes (app.js mounts both), and a bare `router.use()`
// middleware runs for every request that reaches this router regardless
// of which path it eventually matches, before Express even tries
// organizationsRoutes. With no NCC_API_KEY configured (true of every
// environment until Phase 5.4 secrets are provisioned — see .env.example),
// that took down GET/POST/PUT/DELETE /organizations/* — the entire
// Customers page — with a 500 "Service authentication is not configured",
// which is indistinguishable in the UI from "no customers exist". No data
// was ever touched; this is purely a routing bug.
// (Incident: 2026-08-19, see CLAUDE.md/RUNBOOK.md postmortem note.)
const router = Router();

// Accepts either auth scheme this one route needs to serve both callers:
// a human session (Authorization: Bearer <JWT>) or NCC's service API key
// (X-API-Key). Dispatches on which header is present rather than trying
// both, so a request with a missing/garbled Authorization header still
// gets requireAuth's specific 401 (not a misleading API-key error), and a
// service caller with no Authorization header at all keeps getting
// exactly the requireApiKey behavior it already had — including the
// fail-closed 500 when NCC_API_KEY isn't configured.
function requireAuthOrApiKey(req, res, next) {
  if (req.headers.authorization) return requireAuth(req, res, next);
  return requireApiKey(req, res, next);
}

const paramsSchema = z.object({ orgId: z.string().uuid() });
const querySchema = z.object({ at: z.string().datetime({ offset: true }) });

function scopeAllows(scopedIds, organizationId) {
  return scopedIds === null || scopedIds.includes(organizationId);
}

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
router.get('/:orgId/on-call', requireAuthOrApiKey, async (req, res) => {
  const { orgId } = paramsSchema.parse(req.params);
  const { at } = querySchema.parse(req.query);

  // req.user is only set for the human-JWT path (requireAuth) — NCC's
  // service-API-key caller has no Person record and, per its existing
  // contract, sees any Customer in the instance. A human caller gets the
  // same Customer-subtree scoping as every other org-scoped route
  // (lib/orgScope.js's resolveScopedOrgIds, e.g. routes/people.js).
  if (req.user) {
    const scopedIds = await resolveScopedOrgIds(req);
    if (!scopeAllows(scopedIds, orgId)) return res.status(403).json({ error: 'Insufficient permissions' });
  }

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
