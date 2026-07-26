// CSV column templates per entity type — the header row imports/imports.js's
// "download template" endpoint returns, and importEngine.js validates
// uploaded rows against.
export const IMPORT_TEMPLATES = {
  organization: ['name', 'account_number', 'phone', 'email'],
  // 'role' is this app's permission tier (global_admin/customer_admin/user —
  // see middleware/rbac.js's ROLE_RANK), not a job title/position. 'job_title'
  // is the free-text field for that (e.g. "Cardiologist") — importHelpers.js
  // validates 'role' against the real enum values before commit.
  person: ['name', 'email', 'primary_phone', 'sms_phone', 'role', 'job_title', 'department', 'organization_account_number'],
  calendar: ['name', 'description', 'organization_account_number', 'coverage_type'],
  assignment: [
    'calendar_name',
    'date',
    'start_time',
    'end_time',
    'mode',
    'primary_person_email',
    'secondary_person_email',
    'tertiary_person_email',
  ],
};

export function getTemplateHeader(entityType) {
  const columns = IMPORT_TEMPLATES[entityType];
  if (!columns) throw new Error(`Unknown import entity type: ${entityType}`);
  return columns;
}
