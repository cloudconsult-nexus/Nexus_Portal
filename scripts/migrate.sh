#!/usr/bin/env bash
# Runs backend/migrations against a Cloud SQL instance via the Auth Proxy.
# Usage: ./scripts/migrate.sh <INSTANCE_CONNECTION_NAME>
# Requires: TF_VAR_db_password set (same value used in `terraform apply`).

set -euo pipefail

CONN_NAME="${1:?Usage: migrate.sh <instance-connection-name>}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_PORT=15432

if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  echo "cloud-sql-proxy not found. Install it:"
  echo "  curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2/cloud-sql-proxy.linux.amd64"
  echo "  chmod +x cloud-sql-proxy && sudo mv cloud-sql-proxy /usr/local/bin/"
  exit 1
fi

echo "==> Starting Cloud SQL Auth Proxy on 127.0.0.1:${PROXY_PORT}"
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
  npm run migrate

echo "==> Migrations complete"
