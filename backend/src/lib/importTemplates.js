// CSV column templates per entity type — the header row imports/imports.js's
// "download template" endpoint returns, and importEngine.js validates
// uploaded rows against.
export const IMPORT_TEMPLATES = {
  organization: ['name', 'account_number', 'phone', 'email'],
  person: ['name', 'email', 'primary_phone', 'sms_phone', 'role', 'department', 'organization_account_number'],
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
