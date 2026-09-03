#!/usr/bin/env bash
# Resets an existing person's password directly against a deployed Cloud SQL
# instance — for when the forgot-password flow isn't usable (e.g. SMTP isn't
# configured for this environment yet, so reset emails only reach Cloud
# Logging, never an inbox — see RUNBOOK.md's "Email not sending").
# Twin of scripts/seed-admin.sh, same Cloud SQL Auth Proxy pattern.
#
# Usage: ./scripts/reset-password.sh <INSTANCE_CONNECTION_NAME> <email> <new-password>

set -euo pipefail

CONN_NAME="${1:?Usage: reset-password.sh <instance-connection-name> <email> <new-password>}"
EMAIL="${2:?Missing email}"
PASSWORD="${3:?Missing new password}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_PORT=15434

if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  echo "cloud-sql-proxy not found — see scripts/migrate.sh for install instructions."
  exit 1
fi

cloud-sql-proxy --port "$PROXY_PORT" "$CONN_NAME" &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null || true' EXIT
sleep 3

cd "$ROOT_DIR/backend"
DB_HOST=127.0.0.1 \
DB_PORT=$PROXY_PORT \
DB_USER=oncallpro \
DB_PASSWORD="${TF_VAR_db_password:?Set TF_VAR_db_password}" \
DB_NAME=oncallpro \
  node src/resetPassword.js "$EMAIL" "$PASSWORD"
