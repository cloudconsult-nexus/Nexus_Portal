import { heading, para, table, code, callout } from './blocks.js';

export const title = 'API Guide';

export const blocks = [
  para('The web app talks to a JSON REST API. This is a quick reference for anyone scripting against it directly (e.g. for Bulk Import automation).'),

  heading('Authentication'),
  para('POST /auth/login with an email and password returns a bearer JWT (12h expiry). Send it on every subsequent request:'),
  code('Authorization: Bearer <token>'),

  heading('Core resources'),
  table(['Path', 'Notes'], [
    ['/organizations', 'Customers you can see (Global Admin: all; others: your own + its nested descendants). May be nested via parent_id.'],
    ['/organizations/:id/effective-branding', 'A Customer\'s branding after falling back to TAS Settings'],
    ['/tas-settings', 'Instance-wide settings (GET: any authenticated user; PUT: Global Admin only)'],
    ['/tas-settings/public', 'Same read, unauthenticated — what renders the Login screen\'s branding'],
    ['/people', 'On-call contacts and platform accounts, scoped to your Customer\'s subtree. Add ?assignableToOrganizationId= to instead list whoever\'s eligible (primary or linked) for a specific Customer, regardless of your own scope.'],
    ['/people/:id/organizations', 'A person\'s additional (non-primary) Customer links. GET to list, POST { targetOrganizationId } to add, DELETE /:orgId to remove — restricted to the person\'s own nested family.'],
    ['/people/:id/organizations/candidates', 'Which Customers could be added for this person — pre-filtered to valid choices only'],
    ['/people/:id/set-password', 'Global Admin only — set/reset a person\'s password directly and activate their account, no invite needed'],
    ['/invitations', 'Pending/past email invitations; :id/resend and :id/revoke actions'],
    ['/calendars', 'Calendars, scoped to your Customer\'s subtree'],
    ['/assignments?calendarId=&startDate=&endDate=', 'Shifts for a calendar within a date range. POST/PUT validate the assigned person actually belongs (primary or linked) to the calendar\'s Customer, and return { requiresConfirmation: true, conflicts } instead of saving if the person is already booked elsewhere — resubmit with confirmConflicts: true to save anyway.'],
    ['/shift-swaps', 'Swap requests and their approval actions'],
    ['/reports/dashboard-summary?organizationId=', 'Counts and coverage alerts for the Dashboard, rolled up across the Customer\'s subtree'],
    ['/reports/coverage?calendarId=&startDate=&endDate=', 'Per-date covered/total shift counts for one Calendar'],
    ['/reports/workload?organizationId=&startDate=&endDate=', 'Shift count per person across a Customer\'s subtree'],
    ['/reports/hierarchy-summary?organizationId=&startDate=&endDate=', 'Per-Customer breakdown (own numbers, not merged) across a Customer\'s subtree, plus a total'],
    ['/audit-logs', 'Filterable audit trail (Customer Admin and above)'],
  ]),

  heading('Conventions'),
  table(['Convention', 'Detail'], [
    ['Request bodies', 'camelCase field names, e.g. organizationId'],
    ['Response bodies', 'Wrapped in a named key, e.g. { "people": [...] }, matching the resource'],
    ['Soft delete', 'DELETE marks is_deleted rather than removing the row, for Organizations and People'],
    ['Errors', '{ "error": "message" } with an appropriate HTTP status'],
  ]),

  callout('Every route also enforces role and Customer scope server-side — the same rules described in each role\'s guide apply whether you\'re using the UI or calling the API directly.', 'warning'),
];
