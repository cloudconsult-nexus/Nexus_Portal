import { heading, para, table, code, callout, list } from './blocks.js';

export const title = 'API Guide';

export const blocks = [
  para('The web app talks to a JSON REST API. This is a reference for anyone scripting against it directly (e.g. Bulk Import automation) or integrating a system with it. Routes are mounted flat at root — there is no /api/v1 prefix anywhere in this app.'),

  heading('Authentication'),
  para('POST /auth/login with an email and password (plus mfaToken if MFA is enabled) returns a bearer JWT, 12h expiry. Send it on every subsequent request:'),
  code('Authorization: Bearer <token>'),
  para('The token is re-validated against the live person record on every request — a deactivated or deleted account is locked out immediately, not just once the token would otherwise expire.'),
  table(['Route', 'Notes'], [
    ['POST /auth/login', "{ email, password, mfaToken? } → { token, user }. Same 401 for a nonexistent account and a wrong password (no enumeration). 423 if locked (5 failed attempts → 15 min lock). 401 { mfaRequired: true } if MFA is enabled and mfaToken is missing/wrong."],
    ['POST /auth/logout, GET /auth/me', 'Standard session actions.'],
    ['POST /auth/forgot-password, /auth/reset-password', 'Always 204 on forgot-password regardless of whether the account exists (no enumeration). Reset uses a separate 1h-expiry JWT, not the session token.'],
    ['POST /auth/change-password', 'Requires the current password.'],
    ['POST /auth/mfa/enroll, /auth/mfa/verify', 'Two-step: enroll generates+stores a TOTP secret but does NOT enable MFA; verify is what confirms a token against it and flips mfa_enabled on.'],
    ['POST /auth/accept-invite, /auth/accept-terms', 'Token-based (invite) and session-based (terms) respectively.'],
  ]),

  heading('Service authentication (NCC)'),
  para('One route family is not part of the human-facing app: the on-call lookup NCC (Nextiva Contact Center) calls mid-call to resolve who to dispatch to (see "NCC on-call lookup" below). It is authenticated with a static per-instance API key instead of a JWT:'),
  code('X-API-Key: <key>'),
  para('Configured via the NCC_API_KEY environment variable. There is no Person record behind this caller — a request with a missing/wrong key gets 401; if the server-side key itself isn\'t configured, the server fails closed with 500 rather than allowing the request through unauthenticated.'),

  heading('Organization scoping'),
  para('Almost every org-scoped route filters through one shared rule: a Customer Admin/User sees their own Customer + every descendant in the optional parent_id nesting (not just their own single row); a Global Admin sees everything, or can "view as" a specific Customer\'s subtree via ?organizationId=. A non-Global-Admin\'s own ?organizationId= is only honored if it falls within their own subtree.'),
  callout('A few list endpoints do not apply this scoping at all and return every row system-wide: GET /shift-swaps, GET /contact-changes, and GET /invitations. Worth knowing if you\'re consuming these directly — the frontend may apply its own filtering that a raw API client would need to replicate.', 'warning'),

  heading('Core resources'),
  table(['Path', 'Notes'], [
    ['/organizations', 'Customers you can see. GET/POST/PUT for Global Admin; PUT accepts timezone (validated against Intl\'s timezone list) alongside the branding/contact fields. May be nested via parent_id (display/reporting only, not access control).'],
    ['/organizations/:id/effective-branding', "A Customer's branding after falling back to TAS Settings"],
    ['/public-branding/:organizationId', 'Fully unauthenticated — powers branding for a Customer\'s own end users, who are never logged into this app'],
    ['/tas-settings', 'Instance-wide singleton settings (GET: any authenticated user, plus an unauthenticated /public variant for the login screen; PUT: Global Admin only)'],
    ['/people', 'On-call contacts and platform accounts, scoped to your Customer\'s subtree. Add ?assignableToOrganizationId= to instead list whoever\'s eligible (primary or linked) for a specific Customer, regardless of your own scope.'],
    ['/people/:id/organizations', "A person's additional (non-primary) Customer links. GET to list, POST { targetOrganizationId } to add, DELETE /:orgId to remove — restricted to the person's own nested family."],
    ['/people/:id/organizations/candidates', 'Which Customers could be added for this person — pre-filtered to valid choices only'],
    ['/people/:id/set-password', "Global Admin only — set/reset a person's password directly and activate their account, no invite needed"],
    ['/invitations', 'Pending/past email invitations; :id/resend and :id/revoke actions. Not org-scoped — every invitation, system-wide.'],
    ['/calendars', "Calendars, scoped to your Customer's subtree. Now also carries a standing default_person_id — a slot-independent fallback contact, distinct from an individual shift's own default (see On-Call Reports / NCC lookup below)."],
    ['/assignments?calendarId=&startDate=&endDate=', "Shifts for a calendar within a date range. Primary and Default are the only mandatory tiers (may be the same person). POST/PUT validate the assigned person actually belongs (primary or linked) to the calendar's Customer, and return { requiresConfirmation: true, conflicts } instead of saving if someone's already booked elsewhere — resubmit with confirmConflicts: true to save anyway, on purpose. Past assignments are read-only; date/time can't change on PUT (delete + recreate to reschedule)."],
    ['/auto-schedule/preview, /commit', 'Rotation-based bulk scheduling from a set of day-of-week rules — preview computes without writing, commit inserts.'],
    ['/shift-swaps', 'Swap requests and their approval actions. Status flow: pending_target → pending_admin → approved (or rejected/cancelled). Not org-scoped — every swap request, system-wide.'],
    ['/contact-changes', "Self-service contact-edit requests (name/email/phones/department only), admin-approved. Not org-scoped, and approval doesn't check the target person's subtree beyond role rank."],
    ['/reports/dashboard-summary?organizationId=', "Counts and coverage alerts for the Dashboard, rolled up across the Customer's subtree (alerts themselves are single-org, not subtree-rolled-up)"],
    ['/reports/coverage?calendarId=&startDate=&endDate=', 'Per-date covered/total shift counts for one Calendar'],
    ['/reports/workload?organizationId=&startDate=&endDate=', "Shift count per person across a Customer's subtree"],
    ['/reports/hierarchy-summary?organizationId=&startDate=&endDate=', "Per-Customer breakdown (own numbers, not merged) across a Customer's subtree, plus a total"],
    ['/reports/mappings, /reports/mappings/:id/embed', 'Read-only consumer view of the embedded-report catalog (SSO-signed embed URLs where enabled). Admin CRUD lives at /report-mappings, Global Admin only.'],
    ['/audit-logs?entityType=&action=&organizationId=&from=&to=&limit=', 'Filterable audit trail (Customer Admin and above), org-scoped, limit capped at 500'],
    ['/imports', 'CSV bulk import: POST /validate → GET /:batchId → POST /:batchId/commit or /rollback. Per-entity-type permission (organization rows are Global-Admin-only; assignment rows follow the same rule as schedule access; person/calendar rows need Customer Admin+).'],
    ['/customer-messages', 'Nav/permission scaffolding only — no real integration yet. Returns { configured: false } until CUSTOMER_MESSAGING_URL is set.'],
    ['/status-alerts', 'Platform-wide or per-Customer banners. GET /active is the one public route; everything else is Global Admin only.'],
  ]),

  heading('NCC on-call lookup'),
  para('GET /organizations/:orgId/on-call?at=<ISO8601 timestamp> — the inbound endpoint NCC calls mid-call/chat to resolve who to dispatch a message to for a Customer at a given moment. Service-API-key authenticated (see above), not a human JWT route.'),
  list([
    "Resolves the instant into the Customer's local time via its timezone, then checks every one of its calendars and merges the results.",
    'Each covered slot contributes every filled tier — primary, secondary, tertiary, and the slot\'s own default — not just the first match.',
    "A calendar with no assignment row covering the instant at all falls back to that calendar's own standing default_person_id, so the response is never empty for a calendar that has one configured.",
    'Broadcast-mode assignments are excluded entirely — there\'s no primary/secondary/tertiary/default distinction to tag pool members with.',
    'The final list is ordered primary → secondary → tertiary → default across the whole merged result (default always last), with each person tagged on_call_role.',
  ]),
  code('GET /organizations/:orgId/on-call?at=2026-08-18T14:00:00Z\nX-API-Key: <key>\n\n200 { "onCall": [ { ...same shape as /people, "on_call_role": "primary" }, ... ] }'),
  para('Returns 400 for a malformed orgId or missing/invalid at, 404 for a well-formed but nonexistent Customer, and 200 { onCall: [] } (not an error) for a Customer with no calendars.'),

  heading('Conventions'),
  table(['Convention', 'Detail'], [
    ['Request bodies', 'camelCase field names, e.g. organizationId'],
    ['Response bodies', 'Wrapped in a named key, e.g. { "people": [...] }, matching the resource'],
    ['Soft delete', 'DELETE marks is_deleted rather than removing the row, for Organizations and People only. Report Mappings, Status Alerts, and Assignments are hard-deleted (Assignments also write-lock once in the past).'],
    ['Errors', '{ "error": "message" } with an appropriate HTTP status'],
    ['Update routes', "A handful of PUT routes (report-mappings, status-alerts, tas-settings, assignments, organizations) build their update from whichever recognized fields are present in the body, using raw values rather than re-running the same validation their POST/create counterpart applies."],
  ]),

  callout('Every route also enforces role and Customer scope server-side — the same rules described in each role\'s guide apply whether you\'re using the UI or calling the API directly.', 'warning'),
];
