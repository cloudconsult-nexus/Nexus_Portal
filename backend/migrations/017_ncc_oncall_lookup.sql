-- NCC on-call lookup (Phase 5.4, CLAUDE.md "Target spec: TAS Client Portal")
-- needs to resolve a UTC instant against each Customer's LOCAL shift
-- windows, and needs a default contact that is never empty even when no
-- assignment row exists at all for a given moment (a full coverage gap,
-- not just a partial escalation chain) — see routes/onCall.js and
-- lib/calendarService.js#getOnCallAt.

-- Per-Customer IANA timezone (e.g. 'America/Chicago'). Defaults every
-- existing Customer to UTC rather than guessing a real timezone from
-- existing free-text address data — Customer/Global Admins set the real
-- value via PUT /organizations/:id (validated against Intl's timezone
-- list, see lib/calendarService.js#isValidTimeZone).
ALTER TABLE organizations ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

-- A standing, slot-independent default contact per calendar, distinct from
-- assignments.default_person_id (which only applies to its own time slot).
-- Used when no assignment row covers the requested instant at all.
ALTER TABLE calendars ADD COLUMN default_person_id UUID REFERENCES people(id) ON DELETE SET NULL;
