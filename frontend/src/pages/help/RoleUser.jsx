import { heading, para, list, callout } from './blocks.js';

export const title = 'User Guide';
export const role = 'user';

export const blocks = [
  para('Users are on-call contacts with a platform login. Your baseline access is view-only; a Customer Admin can individually grant you schedule-edit authority for more.'),

  heading('What every User can do'),
  list([
    'View Calendars and Schedule in Day, Week, and Month view.',
    'View People (contacts) in your Customer.',
    'Request a Shift Swap for a shift you\'re on, and accept swap requests directed at you.',
    'Upload your own photo from the People page.',
    'View currently active Status Alerts.',
    'Enable two-factor authentication from Settings.',
  ]),

  heading('If you\'ve been granted schedule-edit authority'),
  para('A Customer Admin can grant an individual User the same schedule authority as an admin, without making them an admin:'),
  list([
    'Create, edit, and delete Shifts, including weekly repetition and the Auto-schedule round-robin tool.',
    'Approve or reject Shift Swap requests once the target person has accepted.',
    'Run Bulk Imports for schedule assignments.',
  ]),
  callout('Ask your Customer Admin from the People page if you need this and don\'t have it — it\'s a per-person grant, not a role change.', 'info'),

  heading('What\'s out of reach for every User'),
  list([
    'Creating, editing, or deleting Calendars, or Customer/TAS settings.',
    'Changing anyone\'s role.',
    'Admin screens: Invitations, Bulk Import (organization/person/calendar), OnCall Reports, Audit Logs, Report Mappings.',
  ]),

  callout('Date and time are locked once a shift is created. To reschedule, delete the shift and create a new one — this keeps the audit trail unambiguous.', 'warning'),
];
