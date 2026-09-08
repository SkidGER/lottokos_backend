#!/usr/bin/env bash
set -euo pipefail
source /opt/saylotto-backend/.env
BACKUP_DIR="/var/backups/saylotto"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/saylotto-$STAMP.sql.gz"
find "$BACKUP_DIR" -type f -name 'saylotto-*.sql.gz' -mtime +14 -delete
