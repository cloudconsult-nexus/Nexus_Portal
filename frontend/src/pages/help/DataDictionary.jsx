import { heading, para, table } from './blocks.js';

export const title = 'Data Dictionary';

export const blocks = [
  para('A quick reference for the core entities behind the screens in this app.'),

  heading('TAS Settings'),
  para('A singleton — one deployed Portal instance is one TAS. Holds the instance-wide branding every Customer inherits from by default.'),

  heading('Customer'),
  para('A flat tenant under the TAS — no further nesting. Stored on the `organizations` table internally (kept from before the hierarchy flattened).'),
  table(['Field', 'Notes'], [
    ['account_number, phone, email, address, website', 'Contact details'],
    ['contact_edit_requires_approval', 'Whether a User\'s contact-edit requests need Customer Admin approval, or apply directly'],
    ['logo_url, favicon_url, primary_color, accent_color, name_override, tagline, description, message_html', 'Branding — falls back to TAS Settings for any field left unset'],
  ]),

  heading('Person'),
  para('A unified record for both on-call contacts and platform logins — the same table backs both.'),
  table(['Field', 'Notes'], [
    ['name, email, primary_phone, sms_phone, secondary_phone', 'Contact info'],
    ['role', 'global_admin, customer_admin, or user'],
    ['can_edit_schedule', 'Per-user grant of schedule-edit authority — independent of role, for the User tier'],
    ['login_enabled', 'Whether this person has (or can accept an invite for) a platform login'],
    ['photo_url', 'Uploaded via the People page'],
  ]),

  heading('Calendar & Assignment'),
  table(['Field', 'Notes'], [
    ['calendars.coverage_type', '24x7, business_hours, after_hours, or custom'],
    ['assignments.mode', 'escalation (primary/secondary/tertiary/default with timeouts) or broadcast (a pool)'],
    ['assignments.primary_timeout_min, secondary_timeout_min', 'Minutes before escalation moves to the next tier'],
  ]),

  heading('Shift Swap Request'),
  table(['Field', 'Notes'], [
    ['status', 'pending_target → pending_admin → approved (or rejected/cancelled)'],
    ['swap_role', 'Which slot (primary/secondary/tertiary) on the shift is being swapped'],
  ]),

  heading('Audit Log'),
  para('Append-only. Every create, update, delete, restore, and role_change is recorded with the acting user, before/after values where applicable, and a timestamp.'),
];
