import { parse } from 'csv-parse/sync';
import { getTemplateHeader } from './importTemplates.js';

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
