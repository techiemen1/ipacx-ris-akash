#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_HOST="${POSTGRES_HOST:-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-ris}"
DB_USER="${POSTGRES_USER:-postgres}"
OUT_FILE="${BACKUP_DIR}/ipacx-ris-${DB_NAME}-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

pg_dump \
  --host "$DB_HOST" \
  --port "$DB_PORT" \
  --username "$DB_USER" \
  --format custom \
  --file "$OUT_FILE" \
  "$DB_NAME"

find "$BACKUP_DIR" -type f -name "ipacx-ris-*.dump" -mtime +"$RETENTION_DAYS" -delete

printf '%s\n' "$OUT_FILE"
