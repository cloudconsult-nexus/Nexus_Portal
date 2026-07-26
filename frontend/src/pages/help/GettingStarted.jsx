import { heading, para, list, callout } from './blocks.js';

export const title = 'Getting Started';

export const blocks = [
  para('This is the TAS Client Portal — on-call scheduling and contact management for a Telephone Answering Service, inside the Nexus Portal shell. This page is a quick tour of the core concepts before you dive into Customers, People, and Schedule.'),

  heading('TAS and Customers'),
  para('One deployed Portal instance is one TAS. Every Customer is a flat, independent tenant under it — no further nesting. Branding set at the TAS level (TAS Settings) is the default every Customer inherits from, unless a Customer overrides a field itself.'),
  list([
    'A Customer inherits branding from TAS Settings for any field it hasn\'t overridden — set just a logo without losing the TAS\'s colors.',
    'A Customer Admin is scoped to their own Customer; a Global Admin sees every Customer.',
    'Contacts and schedules never share identity across Customers — the same real person gets a separate record under each Customer they belong to.',
  ]),

  heading('People and roles'),
  para('People are both on-call contacts and platform accounts — the same record, whether or not that person ever logs in. Three role tiers, from most to least privileged:'),
  list([
    'Global Admin — full access across every Customer, plus TAS-wide settings.',
    'Customer Admin — full access within their own Customer.',
    'User — baseline access (view contacts, view schedule); a Customer Admin can individually grant a User schedule-edit authority.',
  ]),

  heading('Scheduling'),
  para('A Calendar holds Shifts (assignments). Each shift is either an escalation chain (Primary → Secondary → Tertiary → Default, each with a timeout) or a broadcast to a pool of people. Shifts can repeat weekly for up to 36 months, and the Auto-schedule tool can round-robin a pool of people across a date range.'),
  callout('Past shifts are read-only. To reschedule one, delete it and create a new shift with the corrected date/time.', 'info'),

  heading('Shift swaps'),
  para('A User requests a swap; the target person accepts; a Customer Admin (or a User granted schedule-edit authority) gives final approval, which is the step that actually changes the assignment.'),

  heading('Where to go next'),
  list([
    'Customers — set up each Customer and its branding.',
    'People — add contacts and invite platform users.',
    'Calendars & Schedule — build out on-call coverage.',
    'Read your role\'s guide in this Help section for a narrower walkthrough.',
  ]),
];
