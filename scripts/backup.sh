#!/usr/bin/env bash
# ==============================================================================
# LVM Panel - Automated Backup Script
# Archives database, configuration, and settings into timestamped tarball
# ==============================================================================

set -e

BACKUP_DIR="/opt/lvm-backups"
PANEL_DIR="/opt/lvm-panel"

if [ ! -d "$PANEL_DIR" ]; then
    PANEL_DIR="$(pwd)"
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/lvm_panel_backup_${TIMESTAMP}.tar.gz"

echo "Creating LVM Panel backup..."
tar -czf "$BACKUP_FILE" -C "$PANEL_DIR" data .env

echo "========================================================"
echo "   Backup completed successfully!"
echo "   Archive saved at: $BACKUP_FILE"
echo "========================================================"
