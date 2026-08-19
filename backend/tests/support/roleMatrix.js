// Source data for the role-authorization audit (tests/roleAudit.test.js)
// and for ROLE_MATRIX.md / ROLE_AUDIT_REPORT.md (scripts/generate-role-docs.mjs).
// Verified directly against backend/src/routes/*.js's requireRole/
// requireScheduleAccess/requireAuth calls and backend/src/middleware/rbac.js
// as of 2026-08-19 — this file (and tests/support/fixtures.js) didn't exist
// in the repo before that; a previous version, if any, predated the
// Phase 5.1 role flattening and would have referenced roles/endpoints that
// no longer exist (see ROLE_AUDIT_REPORT.md's history note). Keep this in
// sync with the route files by hand until there's a way to derive it from
// them directly — do not let it silently drift, since ROLE_MATRIX.md is
// generated from it and is meant to be trustworthy without re-reading the
// routes.

export const ALL_ROLES = ['global_admin', 'customer_admin', 'user'];

export const ROLES = [
  { key: 'global_admin', label: 'Global Admin' },
  { key: 'customer_admin', label: 'Customer Admin' },
  { key: 'user', label: 'User' },
];

const ADMIN_TIER = ['global_admin', 'customer_admin'];
const GLOBAL_ONLY = ['global_admin'];

// Write/admin operations with a server-side role gate. `useFixtureOrgId`
// is unset throughout: every one of these routes runs its role check
// (requireRole / requireScheduleAccess / router-level requireRole) before
// any DB lookup or organization-scope check, so a denied role always gets
// exactly 403 and an allowed role always clears 401/403 (typically landing
// on a 400/404 against a made-up id) regardless of whether the target
// resource is real — see roleAudit.test.js's `record()`, which only
// asserts on crossing the auth boundary, not full CRUD correctness.
export const ENDPOINT_CHECKS = [
  // organizations (routes/organizations.js) — Global Admin only; Customer
  // Admin manages people/calendars/schedule within a Customer, not the
  // Customer record itself.
  { area: 'organizations', capability: 'crud', op: 'create', method: 'post', path: '/organizations', allowedRoles: GLOBAL_ONLY },
  { area: 'organizations', capability: 'crud', op: 'update', method: 'put', path: '/organizations/:id', allowedRoles: GLOBAL_ONLY },
  { area: 'organizations', capability: 'crud', op: 'delete', method: 'delete', path: '/organizations/:id', allowedRoles: GLOBAL_ONLY },
  { area: 'organizations', capability: 'crud', op: 'restore', method: 'post', path: '/organizations/:id/restore', allowedRoles: GLOBAL_ONLY },

  // people (routes/people.js)
  { area: 'people', capability: 'crud', op: 'create', method: 'post', path: '/people', allowedRoles: ADMIN_TIER },
  { area: 'people', capability: 'crud', op: 'update', method: 'put', path: '/people/:id', allowedRoles: ADMIN_TIER },
  { area: 'people', capability: 'crud', op: 'delete', method: 'delete', path: '/people/:id', allowedRoles: ADMIN_TIER },
  { area: 'people', capability: 'crud', op: 'set-password', method: 'post', path: '/people/:id/set-password', allowedRoles: GLOBAL_ONLY },
  { area: 'people', capability: 'crud', op: 'link-organization', method: 'post', path: '/people/:id/organizations', allowedRoles: ADMIN_TIER },
  { area: 'people', capability: 'crud', op: 'unlink-organization', method: 'delete', path: '/people/:id/organizations/:orgId', allowedRoles: ADMIN_TIER },

  // calendars (routes/calendars.js)
  { area: 'calendars', capability: 'crud', op: 'create', method: 'post', path: '/calendars', allowedRoles: ADMIN_TIER },
  { area: 'calendars', capability: 'crud', op: 'update', method: 'put', path: '/calendars/:id', allowedRoles: ADMIN_TIER },
  { area: 'calendars', capability: 'crud', op: 'delete', method: 'delete', path: '/calendars/:id', allowedRoles: ADMIN_TIER },

  // assignments (routes/assignments.js) — requireScheduleAccess also
  // admits a plain User individually granted can_edit_schedule; that's a
  // per-person grant orthogonal to role (CLAUDE.md), not captured by this
  // role-only matrix — the fixture User here has no such grant, so is
  // correctly denied for the baseline role sweep.
  { area: 'assignments', capability: 'crud', op: 'create', method: 'post', path: '/assignments', allowedRoles: ADMIN_TIER },
  { area: 'assignments', capability: 'crud', op: 'update', method: 'put', path: '/assignments/:id', allowedRoles: ADMIN_TIER },
  { area: 'assignments', capability: 'crud', op: 'delete', method: 'delete', path: '/assignments/:id', allowedRoles: ADMIN_TIER },
  { area: 'assignments', capability: 'crud', op: 'copy', method: 'post', path: '/assignments/copy', allowedRoles: ADMIN_TIER },

  // auto-schedule (routes/autoSchedule.js) — same requireScheduleAccess caveat.
  { area: 'auto-schedule', capability: 'crud', op: 'preview', method: 'post', path: '/auto-schedule/preview', allowedRoles: ADMIN_TIER },
  { area: 'auto-schedule', capability: 'crud', op: 'commit', method: 'post', path: '/auto-schedule/commit', allowedRoles: ADMIN_TIER },

  // shift-swaps (routes/shiftSwaps.js) — approve/reject only; request/
  // accept/cancel have no role gate (see READ_CHECKS below).
  { area: 'shift-swaps', capability: 'crud', op: 'approve', method: 'post', path: '/shift-swaps/:id/approve', allowedRoles: ADMIN_TIER },
  { area: 'shift-swaps', capability: 'crud', op: 'reject', method: 'post', path: '/shift-swaps/:id/reject', allowedRoles: ADMIN_TIER },

  // contact-changes (routes/contactChanges.js) — approve/reject only; the
  // self-service POST / has no role gate (see READ_CHECKS below).
  { area: 'contact-changes', capability: 'crud', op: 'approve', method: 'post', path: '/contact-changes/:id/approve', allowedRoles: ADMIN_TIER },
  { area: 'contact-changes', capability: 'crud', op: 'reject', method: 'post', path: '/contact-changes/:id/reject', allowedRoles: ADMIN_TIER },

  // invitations (routes/invitations.js) — whole router is Customer Admin+
  // (router.use(requireAuth, requireRole('customer_admin'), auditContext)).
  { area: 'invitations', capability: 'crud', op: 'list', method: 'get', path: '/invitations', allowedRoles: ADMIN_TIER },
  { area: 'invitations', capability: 'crud', op: 'resend', method: 'post', path: '/invitations/:id/resend', allowedRoles: ADMIN_TIER },
  { area: 'invitations', capability: 'crud', op: 'revoke', method: 'post', path: '/invitations/:id/revoke', allowedRoles: ADMIN_TIER },

  // audit-logs (routes/auditLogs.js)
  { area: 'audit-logs', capability: 'crud', op: 'view', method: 'get', path: '/audit-logs', allowedRoles: ADMIN_TIER },

  // status-alerts (routes/statusAlerts.js) — GET /active is public and
  // excluded here (see READ_CHECKS); everything else is Global Admin only.
  { area: 'status-alerts', capability: 'crud', op: 'list', method: 'get', path: '/status-alerts', allowedRoles: GLOBAL_ONLY },
  { area: 'status-alerts', capability: 'crud', op: 'create', method: 'post', path: '/status-alerts', allowedRoles: GLOBAL_ONLY },
  { area: 'status-alerts', capability: 'crud', op: 'update', method: 'put', path: '/status-alerts/:id', allowedRoles: GLOBAL_ONLY },
  { area: 'status-alerts', capability: 'crud', op: 'delete', method: 'delete', path: '/status-alerts/:id', allowedRoles: GLOBAL_ONLY },

  // report-mappings (routes/reportMappings.js) — admin CRUD catalog, whole
  // router Global Admin only. The read-only consumer view
  // (report-mappings/visible, reports/mappings*) is self-gated per-mapping
  // instead — see READ_CHECKS.
  { area: 'report-mappings', capability: 'crud', op: 'list', method: 'get', path: '/report-mappings', allowedRoles: GLOBAL_ONLY },
  { area: 'report-mappings', capability: 'crud', op: 'create', method: 'post', path: '/report-mappings', allowedRoles: GLOBAL_ONLY },
  { area: 'report-mappings', capability: 'crud', op: 'update', method: 'put', path: '/report-mappings/:id', allowedRoles: GLOBAL_ONLY },
  { area: 'report-mappings', capability: 'crud', op: 'delete', method: 'delete', path: '/report-mappings/:id', allowedRoles: GLOBAL_ONLY },

  // tas-settings (routes/tasSettings.js)
  { area: 'tas-settings', capability: 'crud', op: 'update', method: 'put', path: '/tas-settings', allowedRoles: GLOBAL_ONLY },
  { area: 'tas-settings', capability: 'crud', op: 'logo-upload', method: 'post', path: '/tas-settings/logo', allowedRoles: GLOBAL_ONLY },
  { area: 'tas-settings', capability: 'crud', op: 'favicon-upload', method: 'post', path: '/tas-settings/favicon', allowedRoles: GLOBAL_ONLY },

  // reports (routes/reports.js) — coverage/workload/hierarchy-summary back
  // the OnCall Reports page specifically (Customer-Admin-and-above nav
  // item, frontend/src/navConfig.js's adminOnly). dashboard-summary and
  // mappings* are deliberately NOT here — see READ_CHECKS: dashboard-summary
  // backs the main Dashboard (every role), and mappings* (the read-only
  // consumer view — routes/reportMappings.js is the separate Global-Admin-
  // only CRUD catalog, no relation) is self-gated per-mapping via
  // visible_to_roles, not a blanket role check. Until 2026-08-19 none of
  // coverage/workload/hierarchy-summary had a server-side role gate at
  // all — the UI hid the menu item but the API didn't enforce it; this is
  // the fix for that gap (see RUNBOOK.md).
  { area: 'reports', capability: 'reports', op: 'coverage', method: 'get', path: '/reports/coverage', allowedRoles: ADMIN_TIER },
  { area: 'reports', capability: 'reports', op: 'workload', method: 'get', path: '/reports/workload', allowedRoles: ADMIN_TIER },
  { area: 'reports', capability: 'reports', op: 'hierarchy-summary', method: 'get', path: '/reports/hierarchy-summary', allowedRoles: ADMIN_TIER },
];

// Endpoints with no server-side role gate at all — any authenticated role
// must clear both authentication and authorization (i.e. never 401/403),
// though the *data* returned is still organization-subtree-scoped where
// applicable (see frontend/src/pages/help/ApiGuide.jsx's "Organization
// scoping" section — a separate concern from role, not audited here).
export const READ_CHECKS = [
  { area: 'organizations', op: 'list', method: 'get', path: '/organizations' },
  { area: 'organizations', op: 'get', method: 'get', path: '/organizations/:id' },
  { area: 'organizations', op: 'effective-branding', method: 'get', path: '/organizations/:id/effective-branding' },
  { area: 'people', op: 'list', method: 'get', path: '/people' },
  { area: 'people', op: 'get', method: 'get', path: '/people/:id' },
  { area: 'calendars', op: 'list', method: 'get', path: '/calendars' },
  { area: 'calendars', op: 'get', method: 'get', path: '/calendars/:id' },
  { area: 'assignments', op: 'list', method: 'get', path: '/assignments' },
  { area: 'shift-swaps', op: 'list', method: 'get', path: '/shift-swaps' },
  { area: 'contact-changes', op: 'list', method: 'get', path: '/contact-changes' },
  { area: 'status-alerts', op: 'active', method: 'get', path: '/status-alerts/active' },
  { area: 'reports', op: 'dashboard-summary', method: 'get', path: '/reports/dashboard-summary' },
  { area: 'reports', op: 'mappings', method: 'get', path: '/reports/mappings' },
];
