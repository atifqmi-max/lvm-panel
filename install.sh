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

print_banner() {
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
}

require_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${C_RED}Please run this installer as root (use sudo).${C_RESET}"
        exit 1
    fi
}

# Many cheap/shared "VPS" hosts are themselves running on a container-based
# virtualization layer, where Docker's default overlay2 storage driver fails
# with "invalid argument" mount errors (nested overlayfs isn't supported by
# the kernel in that case). This detects that and falls back automatically:
# fuse-overlayfs first (fast), then vfs (always works, a bit slower).
configure_docker_storage() {
    echo -e "${C_YELLOW}Checking Docker storage driver compatibility...${C_RESET}"

    if docker run --rm hello-world > /tmp/lvm_docker_test.log 2>&1; then
        echo -e "${C_GREEN}Docker storage driver is working fine.${C_RESET}"
        rm -f /tmp/lvm_docker_test.log
        return
    fi

    if grep -qi "overlay" /tmp/lvm_docker_test.log 2>/dev/null; then
        echo -e "${C_YELLOW}Detected an overlay filesystem issue (common on nested/VPS-in-VPS hosts).${C_RESET}"
        echo -e "${C_YELLOW}Trying fuse-overlayfs as a fallback storage driver...${C_RESET}"

        apt-get install -y fuse-overlayfs > /dev/null 2>&1 || true
        mkdir -p /etc/docker
        cat > /etc/docker/daemon.json << 'EOF'
{
  "storage-driver": "fuse-overlayfs"
}
EOF
        systemctl restart docker
        sleep 2

        if docker run --rm hello-world > /tmp/lvm_docker_test2.log 2>&1; then
            echo -e "${C_GREEN}fuse-overlayfs works. Using it as the storage driver.${C_RESET}"
        else
            echo -e "${C_YELLOW}fuse-overlayfs didn't work either, falling back to vfs (always works, a bit slower)...${C_RESET}"
            cat > /etc/docker/daemon.json << 'EOF'
{
  "storage-driver": "vfs"
}
EOF
            systemctl restart docker
            sleep 2
            echo -e "${C_GREEN}Docker is now using the vfs storage driver.${C_RESET}"
        fi
    fi
    rm -f /tmp/lvm_docker_test.log /tmp/lvm_docker_test2.log
}

# ==========================================================
# 1) INSTALL
# ==========================================================
do_install() {
    require_root
    echo -e "${C_YELLOW}Welcome to the LVM Panel installer.${C_RESET}"
    echo "This will install everything needed: Docker, tmate, Python, and the panel itself."
    echo ""

    read -rp "Enter a name for your panel [default: LVM Panel]: " PANEL_NAME
    PANEL_NAME=${PANEL_NAME:-"LVM Panel"}

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

    echo -e "${C_YELLOW}[1/7] Updating system and installing base packages...${C_RESET}"
    apt-get update -y
    apt-get install -y git python3 python3-venv python3-pip curl ca-certificates gnupg tmate lsb-release

    echo -e "${C_YELLOW}[2/7] Installing Docker Engine (needed to run VPS containers)...${C_RESET}"
    if ! command -v docker &> /dev/null; then
        curl -fsSL https://get.docker.com | sh
    fi
    systemctl enable docker
    systemctl start docker

    configure_docker_storage

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

    echo -e "${C_YELLOW}[5/7] Initializing database, admin account and panel settings...${C_RESET}"
    SERVER_IP=$(curl -s https://api.ipify.org || curl -s ifconfig.me || hostname -I | awk '{print $1}')
    PUBLIC_HOST="$SERVER_IP"
    if [[ "$WANT_DOMAIN" =~ ^[Yy]$ ]] && [ -n "$PANEL_DOMAIN" ]; then
        PUBLIC_HOST="$PANEL_DOMAIN"
    fi

    python3 - << PYEOF
import sys
sys.path.insert(0, "$INSTALL_DIR")
import database as db
from werkzeug.security import generate_password_hash

db.init_db()
db.set_setting("panel_name", """$PANEL_NAME""")
db.set_setting("public_ip", """$PUBLIC_HOST""")

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
Description=${PANEL_NAME} - VPS Management Panel
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
        echo -e "${C_GREEN}Domain configured. Point ${PANEL_DOMAIN}'s DNS A record to ${SERVER_IP}.${C_RESET}"
        echo -e "${C_GREEN}For HTTPS, run: apt install certbot python3-certbot-nginx && certbot --nginx -d ${PANEL_DOMAIN}${C_RESET}"
    fi

    echo ""
    echo -e "${C_GREEN}=====================================================${C_RESET}"
    echo -e "${C_GREEN} ${PANEL_NAME} has been installed successfully!${C_RESET}"
    echo -e "${C_GREEN}=====================================================${C_RESET}"
    echo -e " Panel URL      : http://${SERVER_IP}:${PANEL_PORT}"
    if [[ "$WANT_DOMAIN" =~ ^[Yy]$ ]] && [ -n "$PANEL_DOMAIN" ]; then
    echo -e " Custom Domain  : http://${PANEL_DOMAIN}"
    fi
    echo -e " Admin Username : ${ADMIN_USER}"
    echo -e " Admin Password : (the one you entered)"
    echo -e " Public IP set  : ${PUBLIC_HOST}  (shown to members for SSH/Termius, editable in Admin > Settings)"
    echo -e " Service name   : ${SERVICE_NAME} (systemctl status ${SERVICE_NAME})"
    echo -e "${C_GREEN}=====================================================${C_RESET}"
    echo ""
    echo -e "${C_PURPLE}Thank For Using This Script${C_RESET}"
    echo -e "${C_CYAN}Made By LashariGamer${C_RESET}"
    echo ""
}

# ==========================================================
# 2) UNINSTALL
# ==========================================================
do_uninstall() {
    require_root
    echo -e "${C_RED}This will remove LVM Panel, its systemd service, all VPS containers it created,"
    echo -e "its Docker network/images, and (optionally) its Nginx config.${C_RESET}"
    read -rp "Are you sure you want to uninstall LVM Panel? (y/n): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Uninstall cancelled."
        return
    fi

    echo -e "${C_YELLOW}Stopping and removing the panel service...${C_RESET}"
    systemctl stop ${SERVICE_NAME} 2>/dev/null || true
    systemctl disable ${SERVICE_NAME} 2>/dev/null || true
    rm -f /etc/systemd/system/${SERVICE_NAME}.service
    systemctl daemon-reload

    echo -e "${C_YELLOW}Removing VPS containers created by LVM Panel...${C_RESET}"
    docker ps -a --format '{{.Names}}' 2>/dev/null | grep '^lvm-' | xargs -r docker rm -f
    docker images --format '{{.Repository}}' 2>/dev/null | grep '^lvm-panel/' | xargs -r -I{} docker rmi -f {}
    docker network rm lvm_panel_net 2>/dev/null || true

    echo -e "${C_YELLOW}Removing Nginx site (if any)...${C_RESET}"
    rm -f /etc/nginx/sites-enabled/${SERVICE_NAME} /etc/nginx/sites-available/${SERVICE_NAME}
    systemctl reload nginx 2>/dev/null || true

    read -rp "Also delete the panel's database and all files at ${INSTALL_DIR}? (y/n): " DEL_FILES
    if [[ "$DEL_FILES" =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
        echo -e "${C_GREEN}Removed ${INSTALL_DIR}.${C_RESET}"
    else
        echo -e "${C_YELLOW}Kept ${INSTALL_DIR} (only the running service was removed).${C_RESET}"
    fi

    echo ""
    echo -e "${C_GREEN}LVM Panel has been uninstalled.${C_RESET}"
}

# ==========================================================
# 3) ADD SWAP (increase available RAM on the host)
# ==========================================================
do_add_swap() {
    require_root
    echo -e "${C_CYAN}This adds a swap file on your host, which the kernel can use as extra RAM"
    echo -e "when physical memory runs low — useful on low-RAM VPS hosts.${C_RESET}"
    echo ""

    CURRENT_SWAP=$(swapon --show=NAME --noheadings 2>/dev/null || true)
    if [ -n "$CURRENT_SWAP" ]; then
        echo -e "${C_YELLOW}A swap file/partition already seems active:${C_RESET}"
        swapon --show
        read -rp "Add another swap file anyway? (y/n): " CONTINUE_SWAP
        if [[ ! "$CONTINUE_SWAP" =~ ^[Yy]$ ]]; then
            return
        fi
    fi

    read -rp "How many GB of swap do you want to add? [default: 2]: " SWAP_GB
    SWAP_GB=${SWAP_GB:-2}
    SWAP_FILE="/swapfile_lvm_${SWAP_GB}g"

    if [ -f "$SWAP_FILE" ]; then
        echo -e "${C_RED}${SWAP_FILE} already exists. Aborting to avoid overwriting it.${C_RESET}"
        return
    fi

    echo -e "${C_YELLOW}Creating a ${SWAP_GB}GB swap file at ${SWAP_FILE}...${C_RESET}"
    fallocate -l ${SWAP_GB}G "$SWAP_FILE" 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count=$((SWAP_GB*1024))
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE"
    swapon "$SWAP_FILE"

    if ! grep -q "$SWAP_FILE" /etc/fstab; then
        echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
    fi

    echo ""
    echo -e "${C_GREEN}Done! ${SWAP_GB}GB of swap added and enabled on boot.${C_RESET}"
    free -h
}

# ==========================================================
# MENU
# ==========================================================
print_banner
echo "1. Install LVM Panel"
echo "2. Uninstall LVM Panel"
echo "3. Add New Swap For Increase Your Ram"
echo "4. Fix Docker Storage Driver (VPS creation stuck on Error)"
echo ""
read -rp "Select an option [1-4]: " CHOICE

case "$CHOICE" in
    1) do_install ;;
    2) do_uninstall ;;
    3) do_add_swap ;;
    4) require_root; configure_docker_storage ;;
    *) echo -e "${C_RED}Invalid option.${C_RESET}"; exit 1 ;;
esac
