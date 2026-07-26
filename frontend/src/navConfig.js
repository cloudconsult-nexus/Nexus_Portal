import {
  LayoutGrid, Building2, UserRound, CalendarDays, MessageSquare, ShieldCheck,
  CalendarClock, RefreshCw, BarChart3, ScrollText, Settings as SettingsIcon, Radio, Palette, MailPlus, UploadCloud, LayoutDashboard, HelpCircle, Building,
} from 'lucide-react';
import { isAdmin, isGlobalAdmin, canViewMessages } from './lib/roles.js';

// Nexus Portal shell nav — top-level sections, with OnCall Pro as one
// grouped section within it. Extracted from App.jsx (rather than inlined in
// the component) so the role-visibility rules can be tested directly
// against these arrays instead of a re-implemented copy — see
// frontend/tests/navVisibility.test.js and scripts/generate-role-docs.mjs.
export const topNav = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/customers', label: 'Customers', icon: Building2, adminOnly: true },
  { to: '/people', label: 'People', icon: UserRound },
  { to: '/invitations', label: 'Invitations', icon: MailPlus, adminOnly: true },
  { to: '/bulk-import', label: 'Bulk Import', icon: UploadCloud, adminOnly: true },
  { to: '/customer-messages', label: 'Customer Messages', icon: MessageSquare, messagingOnly: true },
  { to: '/secure-messaging', label: 'Secure Messaging', icon: ShieldCheck, messagingOnly: true },
  { to: '/reports', label: 'Reports', icon: BarChart3, adminOnly: true },
  { to: '/status-alerts', label: 'Status Alerts', icon: Radio },
];
export const onCallProNav = [
  { to: '/calendars', label: 'Calendars', icon: CalendarDays },
  { to: '/schedule', label: 'Schedules', icon: CalendarClock },
  { to: '/shift-swaps', label: 'Shift Swaps', icon: RefreshCw },
  { to: '/oncall-reports', label: 'OnCall Reports', icon: BarChart3, adminOnly: true },
];
export const bottomNav = [
  { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText, adminOnly: true },
  { to: '/branding', label: 'Branding', icon: Palette, adminOnly: true },
  { to: '/report-mappings', label: 'Report Mappings', icon: LayoutDashboard, globalAdminOnly: true },
  { to: '/tas-settings', label: 'TAS Settings', icon: Building, globalAdminOnly: true },
  { to: '/help/getting-started', label: 'Help', icon: HelpCircle },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export const NAV_SECTIONS = [
  { key: 'topNav', items: topNav },
  { key: 'onCallProNav', items: onCallProNav },
  { key: 'bottomNav', items: bottomNav },
];

// Same predicate NavList applies per-item — pulled out so it can be tested
// directly against the arrays above for every role.
export function filterNavItems(items, user) {
  return items.filter(
    (item) => (!item.adminOnly || isAdmin(user)) && (!item.messagingOnly || canViewMessages(user)) && (!item.globalAdminOnly || isGlobalAdmin(user))
  );
}
