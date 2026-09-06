#!/usr/bin/env sh
set -eu

if [ "${1:-}" = "" ]; then
  printf 'Usage: %s /path/to/backup.dump\n' "$0" >&2
  exit 2
fi

BACKUP_FILE="$1"
DB_HOST="${POSTGRES_HOST:-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-ris}"
DB_USER="${POSTGRES_USER:-postgres}"

if [ ! -f "$BACKUP_FILE" ]; then
  printf 'Backup file not found: %s\n' "$BACKUP_FILE" >&2
  exit 1
fi

pg_restore \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --dbname "$DB_NAME" \
  --clean \
  --if-exists \
  --no-owner \
  "$BACKUP_FILE"

printf 'Restore completed from %s\n' "$BACKUP_FILE"
