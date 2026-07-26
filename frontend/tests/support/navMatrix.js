// Hand-derived from src/navConfig.js's adminOnly/messagingOnly/globalAdminOnly
// flags crossed with src/lib/roles.js's role hierarchy. Kept as a separate
// fixture (rather than re-deriving in the test itself) so the test is a
// genuine regression check against an independently-reasoned expectation —
// see tests/navVisibility.test.js. Regenerated for the 3-tier role model
// (Phase 5.1 — see CLAUDE.md's "Target spec" section).
export const ROLE_KEYS = ['global_admin', 'customer_admin', 'user'];

const TOP_NAV_ALL = ['Dashboard', 'Customers', 'People', 'Invitations', 'Bulk Import', 'Customer Messages', 'Secure Messaging', 'Reports', 'Status Alerts'];
const TOP_NAV_USER = ['Dashboard', 'People', 'Status Alerts'];

const ONCALL_NAV_ALL = ['Calendars', 'Schedules', 'Shift Swaps', 'OnCall Reports'];
const ONCALL_NAV_USER = ['Calendars', 'Schedules', 'Shift Swaps'];

const BOTTOM_NAV_GLOBAL_ADMIN = ['Audit Logs', 'Branding', 'Report Mappings', 'TAS Settings', 'Help', 'Settings'];
const BOTTOM_NAV_CUSTOMER_ADMIN = ['Audit Logs', 'Branding', 'Help', 'Settings'];
const BOTTOM_NAV_USER = ['Help', 'Settings'];

export const EXPECTED_VISIBLE_LABELS = {
  global_admin: { topNav: TOP_NAV_ALL, onCallProNav: ONCALL_NAV_ALL, bottomNav: BOTTOM_NAV_GLOBAL_ADMIN },
  customer_admin: { topNav: TOP_NAV_ALL, onCallProNav: ONCALL_NAV_ALL, bottomNav: BOTTOM_NAV_CUSTOMER_ADMIN },
  user: { topNav: TOP_NAV_USER, onCallProNav: ONCALL_NAV_USER, bottomNav: BOTTOM_NAV_USER },
};
