import { heading, para, list, callout } from './blocks.js';

export const title = 'Customer Admin Guide';
export const role = 'customer_admin';

export const blocks = [
  para('Customer Admins have full access within their own Customer — everything a Global Admin can do, scoped to your Customer only.'),

  heading('What you can do'),
  list([
    'Manage People and their roles (up to Customer Admin) within your Customer.',
    'Grant or revoke schedule-edit authority for a User in your Customer.',
    'Configure your Customer\'s branding — falls back to TAS Settings for anything you don\'t override.',
    'Choose whether contact edits from your Users apply directly or require your approval first.',
    'Manage Calendars, Schedules, and Shift Swaps.',
    'Send and manage Invitations.',
    'Run Bulk Imports scoped to your Customer.',
    'Review Audit Logs for activity in your Customer.',
  ]),

  heading('What\'s out of reach'),
  list([
    'Other Customers — you won\'t see them in pickers or lists.',
    'Creating, editing, or deleting the Customer record itself, or TAS Settings — Global Admin only.',
    'Report Mappings (the platform-wide report catalog) — Global Admin only.',
    'Promoting someone to Global Admin.',
  ]),

  callout('If you\'ve set "contact edits require approval" for your Customer, a User\'s change request lands here for you to approve or reject before it takes effect.', 'info'),
];
