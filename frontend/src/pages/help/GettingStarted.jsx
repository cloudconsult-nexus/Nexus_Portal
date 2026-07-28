import { heading, para, list, callout } from './blocks.js';

export const title = 'Getting Started';

export const blocks = [
  para('This is the TAS Client Portal — on-call scheduling and contact management for a Telephone Answering Service, inside the Nexus Portal shell. This page is a quick tour of the core concepts before you dive into Customers, People, and Schedule.'),

  heading('TAS and Customers'),
  para('One deployed Portal instance is one TAS. Every Customer is its own independent tenant under it. A Customer can optionally be nested under another Customer for display and reporting purposes — e.g. a hospital and its sister clinics — but this is purely organizational; it does not change what a Customer is or how it\'s billed/managed. Branding set at the TAS level (TAS Settings) is the default every Customer inherits from, unless a Customer overrides a field itself.'),
  list([
    'A Customer inherits branding from TAS Settings for any field it hasn\'t overridden — set just a logo without losing the TAS\'s colors.',
    'A Customer Admin is scoped to their own Customer and every Customer nested under it; a Global Admin sees every Customer and can optionally "view as" any one Customer\'s scope.',
    'Nesting a Customer under another is set from the Customer\'s own edit screen ("Parent customer") — a Customer can only be nested under one it isn\'t already an ancestor of.',
  ]),

  heading('People and roles'),
  para('People are both on-call contacts and platform accounts — the same record, whether or not that person ever logs in. Every person has one primary Customer; they can also be linked to additional Customers within that same nested family (not an unrelated one), which lets them be scheduled on any of those Customers\' calendars too — useful for someone covering more than one site. Three role tiers, from most to least privileged:'),
  list([
    'Global Admin — full access across every Customer, plus TAS-wide settings.',
    'Customer Admin — full access within their own Customer and its nested descendants.',
    'User — baseline access (view contacts, view schedule); a Customer Admin can individually grant a User schedule-edit authority.',
  ]),
  para('A Global Admin can activate a new person\'s login immediately with a password they set directly, instead of waiting on an email invite — useful if invite delivery is down or the person needs access right away. An existing person\'s password can also be reset the same way from their People record.'),

  heading('Scheduling'),
  para('A Calendar holds Shifts (assignments). Each shift is either an Escalation Chain (Primary → Secondary → Tertiary → Default, each contacted in order if the previous doesn\'t respond) or Broadcast/First-Accept (the same four tiers offered the shift simultaneously — whoever accepts first is assigned). Primary and Default are the only mandatory tiers, and may be the same person. Shifts can repeat weekly for up to 36 months, and the Auto-schedule tool can round-robin a pool of people across a date range.'),
  list([
    'A person can only be assigned to a calendar belonging to their primary Customer, or one they\'re additionally linked to — not an arbitrary Customer.',
    'The same person can legitimately be double-booked across calendars or overlapping shifts — this isn\'t blocked, but the scheduler has to explicitly confirm it once shown the conflict before it saves.',
  ]),
  callout('Past shifts are read-only. To reschedule one, delete it and create a new shift with the corrected date/time.', 'info'),

  heading('Shift swaps'),
  para('A User requests a swap; the target person accepts; a Customer Admin (or a User granted schedule-edit authority) gives final approval, which is the step that actually changes the assignment.'),

  heading('Where to go next'),
  list([
    'Customers — set up each Customer, its nesting, and its branding.',
    'People — add contacts, invite platform users (or activate them directly with a password), and link them to additional Customers.',
    'Calendars & Schedule — build out on-call coverage.',
    'OnCall Reports — coverage, workload, and per-Customer breakdowns; see the Reporting reference page.',
    'Read your role\'s guide in this Help section for a narrower walkthrough.',
  ]),
];
