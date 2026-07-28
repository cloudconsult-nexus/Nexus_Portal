import { heading, para, table, list, callout } from './blocks.js';

export const title = 'Reporting';

export const blocks = [
  para('OnCall Reports (admin-only) has three reports, all driven by the same Organization and date-range picker at the top of the page. Every report is scoped to what you\'re allowed to see — a Customer Admin only ever sees their own Customer and its nested descendants; a Global Admin can pick any Customer.'),

  heading('Coverage over time'),
  para('How much scheduled time actually has a Primary person assigned, day by day, over the selected date range. By default this rolls up every Calendar across the selected Organization\'s subtree — leave the Calendar picker on "All calendars (rolled up)" for a parent-organization view spanning multiple schedules, or pick one specific Calendar there to drill into just that schedule.'),
  table(['Field', 'Definition'], [
    ['Coverage %', 'Covered slots ÷ total slots across the whole range, as a whole-number percentage. Shown as "—" if there are no shifts in range at all.'],
    ['byDate', 'One point per date with at least one shift: how many of that day\'s shifts have a Primary person set (covered) versus the day\'s total shift count (total). The chart line is covered ÷ total for each date.'],
  ]),
  callout('A shift only counts as "covered" if its Primary tier is filled — Secondary/Tertiary/Default don\'t count toward this number, since Primary is who\'s actually contacted first.', 'info'),

  heading('Workload by person'),
  para('How many shifts each person was the Primary on, across the selected Organization and date range — a simple fairness check for who\'s carrying the load.'),
  table(['Field', 'Definition'], [
    ['Person', 'Every active person in the selected Organization\'s subtree (itself + every nested descendant Customer), even if their shift count is zero.'],
    ['Shifts', 'Count of assignments in range where this person is the Primary. Secondary/Tertiary/Default assignments aren\'t counted here — see the Data Dictionary for what each tier means.'],
  ]),
  para('Sorted highest to lowest, so the top of the chart is whoever\'s covering the most shifts.'),

  heading('Customer hierarchy summary'),
  para('Only shown when the selected Organization actually has nested children. One row per Customer in the subtree (the parent itself, plus every descendant) — each row is that Customer\'s own direct numbers, not merged with its children\'s, so you can compare a parent against its children side by side. A Total row at the bottom sums every row.'),
  table(['Column', 'Definition'], [
    ['Customer', 'The Customer\'s name. The parent (the one you picked in the Organization selector) is highlighted with a "Parent" badge and always listed first.'],
    ['People', 'Active people whose primary Customer is this row — not counting people additionally linked here from elsewhere (see "Person" in the Data Dictionary for what a link is).'],
    ['Calendars', 'Calendars that belong directly to this Customer.'],
    ['Upcoming shifts', 'Assignments on this Customer\'s calendars falling within the selected date range.'],
    ['Coverage gaps', 'Escalation-mode shifts in range with no Primary person assigned at all. Shown in a red badge when greater than zero.'],
    ['Missing chains', 'Escalation-mode shifts in range that have a Primary but no Secondary and no Default — there\'s nobody to fall back to if Primary doesn\'t respond. Shown in an amber badge when greater than zero.'],
  ]),
  callout('A person linked to a Customer beyond their primary one (an "additional organization," set from their People record) can be scheduled on that Customer\'s calendars, but still only counts toward their primary Customer\'s People total here.', 'info'),

  heading('Exporting'),
  para('Workload and Customer hierarchy summary each have their own "Export PDF" button, producing a simple table export of exactly what\'s on screen. Coverage over time doesn\'t currently export — read the percentage and chart directly from the page.'),
];
