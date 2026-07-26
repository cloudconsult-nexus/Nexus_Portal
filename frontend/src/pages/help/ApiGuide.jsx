import { heading, para, table, code, callout } from './blocks.js';

export const title = 'API Guide';

export const blocks = [
  para('The web app talks to a JSON REST API. This is a quick reference for anyone scripting against it directly (e.g. for Bulk Import automation).'),

  heading('Authentication'),
  para('POST /auth/login with an email and password returns a bearer JWT (12h expiry). Send it on every subsequent request:'),
  code('Authorization: Bearer <token>'),

  heading('Core resources'),
  table(['Path', 'Notes'], [
    ['/organizations', 'Flat list of Customers you can see (Global Admin: all; others: your own)'],
    ['/organizations/:id/effective-branding', 'A Customer\'s branding after falling back to TAS Settings'],
    ['/tas-settings', 'Instance-wide settings (GET: any authenticated user; PUT: Global Admin only)'],
    ['/tas-settings/public', 'Same read, unauthenticated — what renders the Login screen\'s branding'],
    ['/people', 'On-call contacts and platform accounts, scoped to your Customer'],
    ['/calendars', 'Calendars, scoped to your Customer'],
    ['/assignments?calendarId=&startDate=&endDate=', 'Shifts for a calendar within a date range'],
    ['/shift-swaps', 'Swap requests and their approval actions'],
    ['/reports/dashboard-summary?organizationId=', 'Counts and coverage alerts for the Dashboard'],
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
