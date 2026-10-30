#!/usr/bin/env bash
# ==============================================================================
# PumpSentinel PostgreSQL Automated Backup Script
# Performs non-blocking, transaction-safe logical backup using pg_dump
# Suitable for automated cron schedules or manual invocation on Ubuntu.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/pumpsentinel_${TIMESTAMP}.sql.gz"
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}"

echo "=========================================================="
echo "  🛡️  PumpSentinel Database Backup: ${TIMESTAMP}"
echo "=========================================================="

# 1. Check if Docker container pumpsentinel-postgres is running
if docker ps --format '{{.Names}}' | grep -q "^pumpsentinel-postgres$"; then
    echo "• Found running Docker container 'pumpsentinel-postgres'"
    echo "• Dumping database 'pumpsentinel' via docker exec..."
    docker exec -t pumpsentinel-postgres pg_dump -U pumpsentinel -d pumpsentinel --clean --if-exists | gzip > "${BACKUP_FILE}"
elif command -v pg_dump >/dev/null 2>&1; then
    # Fallback to local pg_dump using DATABASE_URL if in environment or .env
    if [ -f "${ROOT_DIR}/.env" ]; then
        # shellcheck disable=SC1091
        set -a && source <(grep -v '^#' "${ROOT_DIR}/.env" | grep -v '^$') && set +a
    fi
    DB_URL="${DATABASE_URL:-postgresql://pumpsentinel:pumpsentinel@localhost:5434/pumpsentinel?schema=public}"
    echo "• Dumping database via local pg_dump..."
    pg_dump "${DB_URL}" --clean --if-exists | gzip > "${BACKUP_FILE}"
else
    echo "❌ Error: Neither 'pumpsentinel-postgres' docker container nor local 'pg_dump' is available." >&2
    exit 1
fi

BACKUP_SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
echo "✅ Backup successfully created:"
echo "   File: ${BACKUP_FILE}"
echo "   Size: ${BACKUP_SIZE}"

# 2. Prune old backups older than RETENTION_DAYS
echo "• Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "pumpsentinel_*.sql.gz" -mtime "+${RETENTION_DAYS}" -exec rm -f {} +

echo "=========================================================="
echo "  Backup Complete."
echo "=========================================================="
