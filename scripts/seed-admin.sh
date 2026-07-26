#!/usr/bin/env bash
# Creates the first Global Admin user against a deployed Cloud SQL instance.
# Usage: ./scripts/seed-admin.sh <INSTANCE_CONNECTION_NAME> <email> <password> <display name>

set -euo pipefail

CONN_NAME="${1:?Usage: seed-admin.sh <instance-connection-name> <email> <password> <name>}"
EMAIL="${2:?Missing email}"
PASSWORD="${3:?Missing password}"
NAME="${4:?Missing display name}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_PORT=15433

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
  node src/seedAdmin.js "$EMAIL" "$PASSWORD" "$NAME"
