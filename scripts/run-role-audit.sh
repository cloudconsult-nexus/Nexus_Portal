#!/usr/bin/env bash
# Runs the role-validation test framework end-to-end: backend authorization
# tests (real Express app + a throwaway fixture org/person per role) and
# frontend menu-visibility tests, then regenerates ROLE_MATRIX.md and
# ROLE_AUDIT_REPORT.md from the results.
# Usage: ./scripts/run-role-audit.sh
# Requires: backend/.env configured with a reachable dev database.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Backend: CRUD / reports / messaging authorization matrix"
(cd "$ROOT_DIR/backend" && npm test)

echo "==> Frontend: menu visibility matrix"
(cd "$ROOT_DIR/frontend" && npm test)

echo "==> Generating ROLE_MATRIX.md + ROLE_AUDIT_REPORT.md"
node "$ROOT_DIR/scripts/generate-role-docs.mjs"

echo "==> Done. See ROLE_MATRIX.md and ROLE_AUDIT_REPORT.md"
