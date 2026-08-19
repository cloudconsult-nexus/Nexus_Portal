import { heading, para, list, callout } from './blocks.js';

export const title = 'Global Admin Guide';
export const role = 'global_admin';

export const blocks = [
  para('Global Admins have unrestricted access across every Customer in this TAS instance, plus a few screens no other role can see.'),

  heading('What only you can do'),
  list([
    'Create, edit, and delete Customer records, including nesting one Customer under another — a Customer Admin manages their own Customer\'s People/Calendars/Schedule, not the Customer record itself.',
    'TAS Settings — the instance-wide branding every Customer inherits from by default.',
    'Report Mappings — configure the platform-wide catalog of embedded reports and who can see each one.',
    'Set or reset a person\'s password directly from their People record, activating their account immediately instead of waiting on an email invite.',
    'Restore a soft-deleted Customer.',
  ]),

  heading('Day to day'),
  list([
    'People — manage accounts and roles across every Customer, including other admins, and link a person to additional Customers within their nested family for full scheduling reach.',
    'Customers — a "view as" selector lets you narrow every admin screen (People, Calendars, Schedule, OnCall Reports) to one Customer\'s subtree at a time; clear it to go back to seeing everything.',
    'OnCall Reports — Coverage, Workload, and the per-Customer hierarchy breakdown, across any Customer\'s subtree.',
    'Audit Logs — review every create/update/delete/role-change/set-password across the platform.',
    'Status Alerts — post platform-wide banners in addition to Customer-scoped ones.',
  ]),

  callout('Role changes are audited distinctly from other edits (a role_change entry, not update) since they\'re a privilege change — check Audit Logs if a permission question comes up.', 'info'),

  heading('NCC integration (on-call lookup)'),
  para('Nextiva Contact Center (NCC) can query this Portal mid-call to find out who\'s on call for a Customer right now — see the API Guide\'s "NCC on-call lookup" and "Service authentication" sections for the endpoint itself. Two things it depends on aren\'t yet reachable from the UI, so they need setting via the API or by whoever manages your deployment:'),
  list([
    'A Customer\'s timezone (defaults to UTC) — determines how the lookup resolves a UTC instant against that Customer\'s local shift windows.',
    "A Calendar's standing default contact — who NCC gets back when no shift at all covers the requested instant, not just an empty escalation chain.",
  ]),
  callout('The NCC_API_KEY that authenticates NCC\'s requests is a deployment-level secret, not something set from within the app — see RUNBOOK.md if you need to set or rotate it.', 'info'),
];
