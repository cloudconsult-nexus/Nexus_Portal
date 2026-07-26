import { parse } from 'csv-parse/sync';
import { getTemplateHeader } from './importTemplates.js';
import { ROLE_RANK } from '../middleware/rbac.js';

const VALID_PERSON_ROLES = Object.keys(ROLE_RANK);

export function parseCsv(buffer) {
  return parse(buffer, { columns: true, skip_empty_lines: true, trim: true });
}

// Row-level structural validation against the entity's template — business
// validation (does this org/person actually exist, etc.) happens in
// importEngine.js since it needs DB lookups.
export function validateRowShape(entityType, row) {
  const expectedColumns = getTemplateHeader(entityType);
  const errors = [];
  for (const col of expectedColumns) {
    if (isRequiredColumn(entityType, col) && !row[col]) {
      errors.push(`Missing required field: ${col}`);
    }
  }
  // 'role' is this app's permission tier, not a job title — catch a
  // mismatch (e.g. a job title like "Cardiologist" in the role column)
  // here, at validate time, rather than as a raw Postgres enum error at
  // commit time.
  if (entityType === 'person' && row.role && !VALID_PERSON_ROLES.includes(row.role)) {
    errors.push(`Invalid role "${row.role}" — must be one of: ${VALID_PERSON_ROLES.join(', ')} (use "job_title" for a position like "Cardiologist")`);
  }
  return errors;
}

function isRequiredColumn(entityType, col) {
  const required = {
    organization: ['name'],
    person: ['name', 'role'],
    calendar: ['name', 'organization_account_number'],
    assignment: ['calendar_name', 'date', 'start_time', 'end_time'],
  };
  return required[entityType]?.includes(col);
}
