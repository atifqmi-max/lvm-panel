#!/bin/bash
set -e

REPO_URL="https://github.com/atifqmi-max/lvm-panel.git"
INSTALL_DIR="/opt/lvm-panel"
SERVICE_NAME="lvm-panel"

C_RESET="\033[0m"
C_PURPLE="\033[1;35m"
C_CYAN="\033[1;36m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_RED="\033[1;31m"

clear
echo -e "${C_PURPLE}"
cat << "EOF"
 _     __     ____  __
| |    \ \   / /  \/  |
| |     \ \ / /| |\/| |     _ __   __ _ _ __   ___| |
| |      \ V / | |  | |    | '_ \ / _` | '_ \ / _ \ |
| |____   | |  | |  | |    | |_) | (_| | | | |  __/ |
|______|  |_|  |_|  |_|    | .__/ \__,_|_| |_|\___|_|
                            |_|
EOF
echo -e "${C_RESET}"
echo -e "${C_CYAN}                     Made By LashariGamer${C_RESET}"
echo ""
sleep 1

if [ "$EUID" -ne 0 ]; then
    echo -e "${C_RED}Please run this installer as root (use sudo).${C_RESET}"
    exit 1
fi

echo -e "${C_YELLOW}Welcome to the LVM Panel installer.${C_RESET}"
echo "This script will install everything needed: Docker, tmate, Python, and the panel itself."
echo ""

# ---------------- Questions ----------------

read -rp "Enter the admin username for LVM Panel: " ADMIN_USER
while true; do
    read -rsp "Enter the admin password: " ADMIN_PASS
    echo ""
    read -rsp "Confirm the admin password: " ADMIN_PASS_CONFIRM
    echo ""
    if [ "$ADMIN_PASS" == "$ADMIN_PASS_CONFIRM" ]; then
        break
    else
        echo -e "${C_RED}Passwords did not match, try again.${C_RESET}"
    fi
done

read -rp "Enter the port to run LVM Panel on [default: 5000]: " PANEL_PORT
PANEL_PORT=${PANEL_PORT:-5000}

read -rp "Does this server have a public IPv4 address? (y/n): " HAS_PUBLIC_IP
read -rp "Do you want to connect a custom domain now? (y/n): " WANT_DOMAIN

if [[ "$WANT_DOMAIN" =~ ^[Yy]$ ]]; then
    read -rp "Enter your domain (e.g. panel.example.com): " PANEL_DOMAIN
fi

echo ""
echo -e "${C_CYAN}Starting installation... this may take a few minutes.${C_RESET}"
echo ""

# ---------------- System packages ----------------

echo -e "${C_YELLOW}[1/7] Updating system and installing base packages...${C_RESET}"
apt-get update -y
apt-get install -y git python3 python3-venv python3-pip curl ca-certificates gnupg tmate lsb-release

echo -e "${C_YELLOW}[2/7] Installing Docker Engine (needed to run VPS containers)...${C_RESET}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
fi
systemctl enable docker
systemctl start docker

echo -e "${C_YELLOW}[3/7] Fetching LVM Panel source...${C_RESET}"
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
fi
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo -e "${C_YELLOW}[4/7] Setting up Python virtual environment...${C_RESET}"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

echo -e "${C_YELLOW}[5/7] Initializing database and creating admin account...${C_RESET}"
python3 - << PYEOF
import sys
sys.path.insert(0, "$INSTALL_DIR")
import database as db
from werkzeug.security import generate_password_hash

db.init_db()
existing = db.get_user_by_username("$ADMIN_USER")
if not existing:
    db.create_user("$ADMIN_USER", generate_password_hash("$ADMIN_PASS"), is_admin=1)
    print("Admin account created.")
else:
    print("Admin account already exists, skipping.")
PYEOF

echo -e "${C_YELLOW}[6/7] Creating systemd service (auto-start on boot)...${C_RESET}"
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(24))")

cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=LVM Panel - VPS Management Panel
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment="LVM_PORT=${PANEL_PORT}"
Environment="LVM_SECRET_KEY=${SECRET_KEY}"
ExecStart=${INSTALL_DIR}/venv/bin/python3 ${INSTALL_DIR}/app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

echo -e "${C_YELLOW}[7/7] Finalizing setup...${C_RESET}"

if [[ "$WANT_DOMAIN" =~ ^[Yy]$ ]] && [ -n "$PANEL_DOMAIN" ]; then
    if ! command -v nginx &> /dev/null; then
        apt-get install -y nginx
    fi
    cat > /etc/nginx/sites-available/${SERVICE_NAME} << EOF
server {
    listen 80;
    server_name ${PANEL_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/${SERVICE_NAME} /etc/nginx/sites-enabled/${SERVICE_NAME}
    nginx -t && systemctl restart nginx
    echo -e "${C_GREEN}Domain configured. Point ${PANEL_DOMAIN}'s DNS A record to this server's IP.${C_RESET}"
    echo -e "${C_GREEN}For HTTPS, run: apt install certbot python3-certbot-nginx && certbot --nginx -d ${PANEL_DOMAIN}${C_RESET}"
fi

SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')

echo ""
echo -e "${C_GREEN}=====================================================${C_RESET}"
echo -e "${C_GREEN} LVM Panel has been installed successfully!${C_RESET}"
echo -e "${C_GREEN}=====================================================${C_RESET}"
echo -e " Panel URL      : http://${SERVER_IP}:${PANEL_PORT}"
if [[ "$WANT_DOMAIN" =~ ^[Yy]$ ]] && [ -n "$PANEL_DOMAIN" ]; then
echo -e " Custom Domain  : http://${PANEL_DOMAIN}"
fi
echo -e " Admin Username : ${ADMIN_USER}"
echo -e " Admin Password : (the one you entered)"
echo -e " Service name   : ${SERVICE_NAME} (systemctl status ${SERVICE_NAME})"
echo -e "${C_GREEN}=====================================================${C_RESET}"
echo ""
echo -e "${C_PURPLE}Thank For Using This Script${C_RESET}"
echo -e "${C_CYAN}Made By LashariGamer${C_RESET}"
echo ""
