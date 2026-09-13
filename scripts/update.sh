#!/usr/bin/env bash
# ==============================================================================
# LVM Panel - Automated Updater Script
# GitHub: https://github.com/atifqmi-max/lvm-panel
# ==============================================================================

set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[Error] Please run updater as root.${NC}"
    exit 1
fi

INSTALL_DIR="/opt/lvm-panel"
if [ ! -d "$INSTALL_DIR" ]; then
    INSTALL_DIR="$(pwd)"
fi

echo -e "${CYAN}======================================================${NC}"
echo -e "${CYAN}   Updating LVM Panel in $INSTALL_DIR...              ${NC}"
echo -e "${CYAN}======================================================${NC}"

cd "$INSTALL_DIR"

# Backup database before update
if [ -f "$INSTALL_DIR/data/lvm_db.json" ]; then
    echo "Creating safety database snapshot..."
    cp "$INSTALL_DIR/data/lvm_db.json" "$INSTALL_DIR/data/lvm_db_pre_update.json.bak"
fi

# Pull latest code
echo "Pulling latest code from GitHub..."
git pull origin main || echo "Git pull skipped or local directory."

# Update dependencies
echo "Updating npm dependencies..."
npm install --omit=dev

# Restart systemd service if active
if systemctl is-active --quiet lvm-panel; then
    echo "Restarting lvm-panel systemd service..."
    systemctl restart lvm-panel
fi

echo -e "${GREEN}======================================================${NC}"
echo -e "${GREEN}   LVM Panel updated and restarted successfully!      ${NC}"
echo -e "${GREEN}======================================================${NC}"
