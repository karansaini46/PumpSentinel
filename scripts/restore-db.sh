#!/usr/bin/env bash
# ==============================================================================
# PumpSentinel PostgreSQL Database Restore Script
# Restores database from a compressed .sql.gz backup file.
# Usage: ./scripts/restore-db.sh [path/to/backup.sql.gz]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path-to-backup.sql.gz>"
    echo "Example: $0 ./backups/pumpsentinel_20261030_120000.sql.gz"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "❌ Error: Backup file not found: ${BACKUP_FILE}" >&2
    exit 1
fi

echo "=========================================================="
echo "  🛡️  PumpSentinel Database Restore"
echo "=========================================================="
echo "• Target file: ${BACKUP_FILE}"
echo "• Size: $(du -h "${BACKUP_FILE}" | cut -f1)"
echo ""
echo "⚠️  WARNING: Restoring will overwrite the current database tables."
echo "Press Ctrl+C within 5 seconds to cancel..."
sleep 5

# 1. Restore via Docker container if running
if docker ps --format '{{.Names}}' | grep -q "^pumpsentinel-postgres$"; then
    echo "• Restoring into Docker container 'pumpsentinel-postgres'..."
    gunzip -c "${BACKUP_FILE}" | docker exec -i pumpsentinel-postgres psql -U pumpsentinel -d pumpsentinel
elif command -v psql >/dev/null 2>&1; then
    if [ -f "${ROOT_DIR}/.env" ]; then
        # shellcheck disable=SC1091
        set -a && source <(grep -v '^#' "${ROOT_DIR}/.env" | grep -v '^$') && set +a
    fi
    DB_URL="${DATABASE_URL:-postgresql://pumpsentinel:pumpsentinel@localhost:5434/pumpsentinel?schema=public}"
    echo "• Restoring via local psql..."
    gunzip -c "${BACKUP_FILE}" | psql "${DB_URL}"
else
    echo "❌ Error: Neither 'pumpsentinel-postgres' container nor local 'psql' is available." >&2
    exit 1
fi

echo "• Verifying database schema with Prisma..."
cd "${ROOT_DIR}"
npx prisma migrate status

echo "=========================================================="
echo "✅ Database restore successfully completed."
echo "=========================================================="
