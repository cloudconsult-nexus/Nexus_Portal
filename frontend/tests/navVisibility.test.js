import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import { topNav, onCallProNav, bottomNav, filterNavItems } from '../src/navConfig.js';
import { ROLE_KEYS, EXPECTED_VISIBLE_LABELS } from './support/navMatrix.js';

const SECTIONS = { topNav, onCallProNav, bottomNav };

// Dumped in afterAll so scripts/generate-role-docs.mjs can render an
// ROLE_AUDIT_REPORT.md section from an actual test run, alongside the
// backend's tests/results/backend-role-audit.json.
const results = [];

afterAll(() => {
  const outDir = path.join(process.cwd(), 'tests', 'results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'frontend-role-audit.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)
  );
});

describe('menu visibility per role', () => {
  for (const role of ROLE_KEYS) {
    for (const [sectionKey, items] of Object.entries(SECTIONS)) {
      it(`${role} sees the expected ${sectionKey} items`, () => {
        const visibleLabels = filterNavItems(items, { role }).map((i) => i.label);
        const expected = EXPECTED_VISIBLE_LABELS[role][sectionKey];
        const pass = JSON.stringify(visibleLabels) === JSON.stringify(expected);
        results.push({ area: 'menu', capability: 'menu', op: sectionKey, role, expectedAllowed: true, status: pass ? 'match' : 'mismatch', pass, visibleLabels, expected });
        expect(visibleLabels).toEqual(expected);
      });
    }
  }
});
