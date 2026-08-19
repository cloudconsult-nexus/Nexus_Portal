import { heading, para, table } from './blocks.js';

export const title = 'Data Dictionary';

export const blocks = [
  para('A quick reference for the core entities behind the screens in this app.'),

  heading('TAS Settings'),
  para('A singleton — one deployed Portal instance is one TAS. Holds the instance-wide branding every Customer inherits from by default.'),

  heading('Customer'),
  para('An independent tenant under the TAS, stored on the `organizations` table. A Customer can optionally be nested under another Customer (`parent_id`) for display/reporting grouping — this is separate from access control, which still follows the subtree (see the Person section below).'),
  table(['Field', 'Notes'], [
    ['parent_id', 'Optional — nests this Customer under another for display and roll-up reporting. A Customer can\'t be nested under its own descendant (checked on save).'],
    ['account_number, phone, email, address, website', 'Contact details'],
    ['contact_edit_requires_approval', 'Whether a User\'s contact-edit requests need Customer Admin approval, or apply directly'],
    ['timezone', 'IANA timezone (e.g. America/Chicago), defaults to UTC. Used to resolve the NCC on-call lookup\'s UTC instant against this Customer\'s local shift windows. Settable via the API (PUT /organizations/:id) — not yet exposed in the Customers page UI.'],
    ['logo_url, favicon_url, primary_color, accent_color, name_override, tagline, description, message_html', 'Branding — falls back to TAS Settings for any field left unset'],
  ]),

  heading('Person'),
  para('A unified record for both on-call contacts and platform logins — the same table backs both. Every person has exactly one primary Customer (`organization_id`).'),
  table(['Field', 'Notes'], [
    ['name, email, primary_phone, sms_phone, secondary_phone', 'Contact info'],
    ['organization_id', 'Primary Customer — determines which Customer Admin manages this person and where they show up by default'],
    ['role', 'global_admin, customer_admin, or user'],
    ['can_edit_schedule', 'Per-user grant of schedule-edit authority — independent of role, for the User tier'],
    ['login_enabled', 'Whether this person has (or can accept an invite for, or had a password set directly by a Global Admin for) a platform login'],
    ['photo_url', 'Uploaded via the People page'],
  ]),
  para('A person can also be linked to additional Customers beyond their primary one, via the `person_organizations` table — restricted to Customers within the same nested family as their primary Customer. A link doesn\'t change who manages the person\'s record; it only means they can be scheduled (Primary/Secondary/Tertiary/Default) on that Customer\'s calendars too. Managed from the "Additional organizations" section of a person\'s record.'),

  heading('Calendar & Assignment'),
  table(['Field', 'Notes'], [
    ['calendars.coverage_type', '24x7, business_hours, after_hours, or custom'],
    ['calendars.default_person_id', 'A standing, slot-independent fallback contact for this calendar — distinct from an individual shift\'s own default. Used by the NCC on-call lookup when no shift at all covers the requested instant, so the response is never empty for a calendar that has one set. Settable via the API (PUT /calendars/:id) — not yet exposed in the Calendars page UI.'],
    ['assignments.mode', 'escalation (Primary → Secondary → Tertiary → Default in order) or broadcast (the same four tiers offered simultaneously — first to accept wins)'],
    ['assignments.primary_person_id, default_person_id', 'The only mandatory tiers — may be the same person'],
    ['assignments.secondary_person_id, tertiary_person_id', 'Optional, for either mode'],
    ['assignments.primary_timeout_min, secondary_timeout_min', 'Escalation mode only — minutes before moving to the next tier'],
    ['assignments.broadcast_pool, accepted_by', 'Broadcast mode only — who was offered the shift and who (if anyone) accepted'],
  ]),
  para('A person can only be assigned to a calendar belonging to their primary Customer or a Customer they\'re additionally linked to. The same person can be double-booked across calendars or overlapping shifts on purpose — the scheduler must explicitly confirm the conflict first, but it\'s never hard-blocked.'),

  heading('Shift Swap Request'),
  table(['Field', 'Notes'], [
    ['status', 'pending_target → pending_admin → approved (or rejected/cancelled)'],
    ['swap_role', 'Which slot (primary/secondary/tertiary) on the shift is being swapped'],
  ]),

  heading('Audit Log'),
  para('Append-only. Records the acting user, before/after values where applicable, and a timestamp, for these actions: create, update, delete, restore, move, role_change, set_password, login, logout, and view (viewing an embedded report).'),
];
