#!/usr/bin/env bash
# ==============================================================================
# LVM Panel - Automated Installation Script (Linux VPS / Server)
# GitHub Repository: https://github.com/atifqmi-max/lvm-panel
# Default Port: 3000
# ==============================================================================

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Check root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[Error] Please run this installer as root (e.g. sudo bash install.sh)${NC}"
    exit 1
fi

clear
echo -e "${CYAN}${BOLD}"
echo "  _     _     _ __  __   ____                  _ "
echo " | |   | |   | |  \/  | |  _ \ __ _ _ __   ___| |"
echo " | |   | \ / / | |\/| | | |_) / _\` | '_ \ / _ \ |"
echo " | |___ \ V /  | |  | | |  __/ (_| | | | |  __/ |"
echo " |_____| \_/   |_|  |_| |_|   \__,_|_| |_|\___|_|"
echo -e "${NC}"
echo -e "${BOLD}Next-Gen Linux Virtual Machine & Container Cloud Manager${NC}"
echo -e "Repository: https://github.com/atifqmi-max/lvm-panel"
echo "----------------------------------------------------------------------"
echo ""

# Interactive prompts for Admin account credentials
echo -e "${YELLOW}Please enter your Administrator account credentials:${NC}"
read -rp "Enter Admin Email: " ADMIN_EMAIL
while [[ -z "$ADMIN_EMAIL" ]]; do
    echo -e "${RED}Email cannot be empty!${NC}"
    read -rp "Enter Admin Email: " ADMIN_EMAIL
done

read -rp "Enter Admin Password: " ADMIN_PASSWORD
while [[ -z "$ADMIN_PASSWORD" || ${#ADMIN_PASSWORD} -lt 6 ]]; do
    echo -e "${RED}Password cannot be empty and must be at least 6 characters long!${NC}"
    read -rp "Enter Admin Password: " ADMIN_PASSWORD
done

read -rp "Enter Admin Username (Default: admin): " ADMIN_USERNAME
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}

echo ""
echo -e "${CYAN}[1/6] Detecting network and server specifications...${NC}"

# Detect Public IP
VPS_IP=$(curl -s -4 https://ifconfig.me || curl -s -4 https://icanhazip.com || hostname -I | awk '{print $1}')
if [[ -z "$VPS_IP" ]]; then
    VPS_IP="127.0.0.1"
fi
echo -e "Server Public IP detected: ${BOLD}${VPS_IP}${NC}"

# Update apt/yum package lists
echo ""
echo -e "${CYAN}[2/6] Updating system packages & installing container prerequisites...${NC}"
if [ -x "$(command -v apt-get)" ]; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y curl wget git lxc lxc-templates bridge-utils iptables ufw build-essential
elif [ -x "$(command -v yum)" ]; then
    yum update -y
    yum install -y curl wget git lxc iptables
else
    echo -e "${YELLOW}Warning: Unsupported package manager. Continuing...${NC}"
fi

# Install Node.js if missing or older than v18
echo ""
echo -e "${CYAN}[3/6] Checking Node.js runtime environment...${NC}"
NEED_NODE=false
if ! [ -x "$(command -v node)" ]; then
    NEED_NODE=true
else
    NODE_MAJOR=$(node -v | cut -d'.' -f1 | tr -d 'v')
    if [ "$NODE_MAJOR" -lt 18 ]; then
        NEED_NODE=true
    fi
fi

if [ "$NEED_NODE" = true ]; then
    echo "Installing Node.js 20 LTS..."
    if [ -x "$(command -v apt-get)" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    elif [ -x "$(command -v yum)" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs
    fi
fi
echo -e "Node.js version: ${BOLD}$(node -v)${NC}, npm version: ${BOLD}$(npm -v)${NC}"

# Setup Panel Directory & Code
echo ""
echo -e "${CYAN}[4/6] Setting up LVM Panel in /opt/lvm-panel...${NC}"
INSTALL_DIR="/opt/lvm-panel"

if [ -d "$INSTALL_DIR" ]; then
    echo "Existing installation found. Creating backup..."
    mv "$INSTALL_DIR" "${INSTALL_DIR}_backup_$(date +%s)"
fi

mkdir -p "$INSTALL_DIR"

# If running directly inside cloned directory, copy files; otherwise clone from github
if [ -f "./package.json" ] && [ -d "./src" ]; then
    echo "Copying local source files..."
    cp -r ./* "$INSTALL_DIR/"
else
    echo "Cloning official repository: https://github.com/atifqmi-max/lvm-panel..."
    git clone https://github.com/atifqmi-max/lvm-panel.git "$INSTALL_DIR" || {
        echo -e "${RED}[Error] Failed to clone repository. Check internet access.${NC}"
        exit 1
    }
fi

cd "$INSTALL_DIR"

# Create .env configuration
RANDOM_SECRET=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32 ; echo '')
cat <<EOF > "$INSTALL_DIR/.env"
PORT=3000
HOST=0.0.0.0
JWT_SECRET=${RANDOM_SECRET}
JWT_EXPIRES_IN=7d
DB_FILE=data/lvm_db.json
NODE_ENV=production
EOF

# Install dependencies
echo "Installing NPM production packages..."
npm install --omit=dev

# Initialize Database with entered Admin credentials
echo ""
echo -e "${CYAN}[5/6] Initializing database and administrator account...${NC}"
mkdir -p "$INSTALL_DIR/data"
node src/database/seed.js "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$ADMIN_USERNAME"

# Create Systemd Service
echo ""
echo -e "${CYAN}[6/6] Configuring Systemd service & firewall...${NC}"
cat <<EOF > /etc/systemd/system/lvm-panel.service
[Unit]
Description=LVM Panel - Cloud Virtualization Manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lvm-panel
systemctl restart lvm-panel

# Open firewall port 3000 if UFW is installed
if [ -x "$(command -v ufw)" ]; then
    ufw allow 3000/tcp comment 'LVM Panel Web Interface' >/dev/null 2>&1 || true
fi

# Final Output Banner in English
echo ""
echo -e "${GREEN}${BOLD}======================================================================${NC}"
echo -e "${GREEN}${BOLD}                  LVM Panel Installed Successfully!                   ${NC}"
echo -e "${GREEN}${BOLD}======================================================================${NC}"
echo ""
echo -e "  ${BOLD}Panel URL:${NC}        ${CYAN}http://${VPS_IP}:3000${NC}"
echo -e "  ${BOLD}Admin Email:${NC}      ${GREEN}${ADMIN_EMAIL}${NC}"
echo -e "  ${BOLD}Admin Password:${NC}   ${GREEN}${ADMIN_PASSWORD}${NC}"
echo -e "  ${BOLD}Panel Port:${NC}       3000"
echo -e "  ${BOLD}Service Status:${NC}   systemctl status lvm-panel"
echo ""
echo -e "  ${YELLOW}Notice:${NC} Please open port 3000 in your cloud provider security group"
echo -e "  (e.g., AWS, DigitalOcean, Hetzner, Contabo) if you cannot reach the URL."
echo ""
echo -e "${GREEN}${BOLD}======================================================================${NC}"
