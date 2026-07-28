import { heading, para, list, callout } from './blocks.js';

export const title = 'Customer Admin Guide';
export const role = 'customer_admin';

export const blocks = [
  para('Customer Admins have full access within their own Customer and every Customer nested under it — everything a Global Admin can do, scoped to that subtree.'),

  heading('What you can do'),
  list([
    'Manage People and their roles (up to Customer Admin) within your Customer\'s subtree.',
    'Link a person to additional Customers within your own subtree, so they can be scheduled on more than one Customer\'s calendars — from the "Additional organizations" section of their record.',
    'Grant or revoke schedule-edit authority for a User in your subtree.',
    'Configure your Customer\'s branding — falls back to TAS Settings for anything you don\'t override.',
    'Choose whether contact edits from your Users apply directly or require your approval first.',
    'Manage Calendars, Schedules, and Shift Swaps across your subtree.',
    'Send and manage Invitations.',
    'Run Bulk Imports scoped to your subtree.',
    'View OnCall Reports — Coverage, Workload, and the per-Customer breakdown — for your subtree.',
    'Review Audit Logs for activity in your subtree.',
  ]),

  heading('What\'s out of reach'),
  list([
    'Customers outside your own subtree — you won\'t see them in pickers or lists.',
    'Creating, editing, or deleting any Customer record, or setting a Customer\'s nesting/parent — Global Admin only.',
    'Setting a person\'s password directly (bypassing the email invite) — Global Admin only.',
    'TAS Settings, or Report Mappings (the platform-wide report catalog) — Global Admin only.',
    'Promoting someone to Global Admin.',
  ]),

  callout('If you\'ve set "contact edits require approval" for your Customer, a User\'s change request lands here for you to approve or reject before it takes effect.', 'info'),
];
