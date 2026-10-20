#!/usr/bin/env bash
# LVM Panel one-command installer and management menu.
set -Eeuo pipefail
APP_DIR="/opt/lvm-panel"
REPO="https://github.com/atifqmi-max/lvm-panel"
BRANCH="main"
SERVICE="lvm-panel"
PORT="${PORT:-5000}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/nrb.py" ]]; then cd "$SCRIPT_DIR"; fi

# `curl | sudo bash` uses stdin for the download, so attach interactive menu reads to the TTY.
# Automation can use `bash install.sh --install` and does not need a terminal.
if [[ "${1:-}" != "--install" && ! -t 0 ]]; then
  if [[ -r /dev/tty ]]; then
    exec </dev/tty
  else
    echo "Interactive menu requires a terminal. Use bash install.sh --install for unattended installation."
    exit 2
  fi
fi

trap 'rc=$?; echo; echo "[ERROR] Command failed (exit $rc) at line ${LINENO}. Review the message above."; exit "$rc"' ERR

need_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "Please run with sudo/root: sudo bash install.sh"
    exit 1
  fi
}

bootstrap_source() {
  if [[ -f "$PWD/nrb.py" && -f "$PWD/lxd_backend.py" ]]; then
    echo "$PWD"
    return
  fi
  local tmp
  tmp="$(mktemp -d)"
  echo "Downloading LVM Panel source from ${REPO} (${BRANCH})..." >&2
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --branch "$BRANCH" "$REPO" "$tmp/source" >/dev/null 2>&1 || true
  fi
  if [[ ! -f "$tmp/source/nrb.py" ]]; then
    rm -rf "$tmp/source"
    mkdir -p "$tmp/source"
    apt-get update -qq >&2
    apt-get install -y -qq ca-certificates curl unzip >&2
    curl -fL --retry 3 "https://codeload.github.com/atifqmi-max/lvm-panel/zip/refs/heads/${BRANCH}" -o "$tmp/source.zip"
    unzip -q "$tmp/source.zip" -d "$tmp/unpacked"
    local top
    top="$(find "$tmp/unpacked" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    [[ -n "$top" && -f "$top/nrb.py" ]] || { echo "Could not find nrb.py in the downloaded repository."; exit 1; }
    cp -a "$top/." "$tmp/source/"
  fi
  [[ -f "$tmp/source/nrb.py" ]] || { echo "Repository download did not contain nrb.py."; exit 1; }
  echo "$tmp/source"
}

install_panel() {
  echo
  echo "== Install / initialize LVM Panel =="
  local source
  source="$(bootstrap_source)"
  if [[ "$source" != "$APP_DIR" ]]; then
    mkdir -p "$APP_DIR"
    cp -a "$source/." "$APP_DIR/"
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y python3 python3-venv python3-pip ca-certificates curl unzip snapd socat ufw
  if [[ "$(ps -p 1 -o comm= | tr -d '[:space:]')" != "systemd" || ! -d /run/systemd/system ]]; then
    echo "This host does not use systemd as PID 1. LXD installation requires a full Ubuntu/Debian VM/VPS with systemd."
    echo "The source was placed in $APP_DIR, but LXD/service setup was not completed."
    return 1
  fi
  systemctl enable --now snapd.socket
  for i in $(seq 1 45); do
    if snap version >/dev/null 2>&1; then break; fi
    sleep 1
  done
  snap version >/dev/null 2>&1 || { echo "snapd did not become ready; check: systemctl status snapd.socket snapd"; return 1; }
  if ! snap list lxd >/dev/null 2>&1; then snap install lxd; fi
  systemctl enable --now snap.lxd.daemon || true
  lxd waitready --timeout=120
  local storage_ready=0 network_ready=0
  lxc storage list --format=json 2>/dev/null | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin) else 1)' && storage_ready=1 || true
  lxc network list --format=json 2>/dev/null | python3 -c 'import json,sys; sys.exit(0 if any(x.get("type")=="bridge" for x in json.load(sys.stdin)) else 1)' && network_ready=1 || true
  if [[ "$storage_ready" -ne 1 || "$network_ready" -ne 1 ]]; then lxd init --auto; fi
  lxc info >/dev/null
  cd "$APP_DIR"
  python3 -m venv venv
  venv/bin/python -m pip install --upgrade pip
  venv/bin/python -m pip install -r requirements.txt
  python3 -m py_compile nrb.py api.py node.py lxd_backend.py security_utils.py
  chmod +x start.sh nrb-tool.sh install.sh

  if [[ ! -f /etc/lvm-panel.env ]]; then
    local secret adminpass
    secret="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
    adminpass="$(python3 -c 'import secrets; print(secrets.token_urlsafe(15))')"
    cat > /etc/lvm-panel.env <<EOF
PANEL_NAME=LVM Panel
PANEL_VERSION=1.1
PANEL_DEVELOPER=LVM Panel
SECRET_KEY=${secret}
DATABASE_PATH=${APP_DIR}/nrb.db
HOST=0.0.0.0
PORT=${PORT}
MAIN_ADMIN_USERNAME=admin
MAIN_ADMIN_PASSWORD=${adminpass}
MAIN_ADMIN_EMAIL=admin@localhost
DEBUG_MODE=False
TRUST_PROXY_HEADERS=False
LVM_ALLOW_PRIVILEGED_CONTAINERS=False
EOF
    chmod 600 /etc/lvm-panel.env
    printf '%s\n' "Initial admin credentials (save them now):" "Username: admin" "Password: $adminpass" | tee /root/lvm-panel-credentials.txt
    chmod 600 /root/lvm-panel-credentials.txt
  fi

  cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=LVM Panel Web Application
After=network-online.target snap.lxd.daemon.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=/etc/lvm-panel.env
ExecStart=${APP_DIR}/venv/bin/python ${APP_DIR}/nrb.py
Restart=on-failure
RestartSec=5
UMask=0027
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$SERVICE"
  echo
  echo "Installation complete."
  echo "Panel: http://YOUR_SERVER_IP:${PORT}"
  echo "Credentials saved in: /root/lvm-panel-credentials.txt"
  echo "Security: use HTTPS behind a trusted reverse proxy before exposing login traffic publicly."
  echo "Node agent defaults to localhost; configure NODE_BIND_HOST and firewall rules for remote nodes."
  echo "Service: systemctl status ${SERVICE}"
}

start_panel() { systemctl start "$SERVICE"; systemctl --no-pager --full status "$SERVICE" || true; }
stop_panel() { systemctl stop "$SERVICE"; echo "LVM Panel stopped."; }
restart_panel() { systemctl restart "$SERVICE"; systemctl --no-pager --full status "$SERVICE" || true; }
status_panel() {
  echo "== Service =="; systemctl --no-pager --full status "$SERVICE" || true
  echo; echo "== LXD =="; if command -v lxc >/dev/null 2>&1; then lxc info 2>&1 | head -n 25 || true; else echo "LXD not installed"; fi
  echo; echo "== Listening port =="; ss -lntp 2>/dev/null | grep -E ":${PORT}[[:space:]]" || echo "Nothing listening on port ${PORT}"
}
logs_panel() { journalctl -u "$SERVICE" -n 100 --no-pager; }
repair_panel() {
  [[ -d "$APP_DIR" ]] || { echo "Panel is not installed. Choose Install first."; return 1; }
  apt-get update
  apt-get install -y python3 python3-venv python3-pip socat
  cd "$APP_DIR"
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
  venv/bin/python -m py_compile nrb.py api.py node.py lxd_backend.py
  systemctl daemon-reload
  systemctl restart "$SERVICE" || true
  echo "Repair checks completed. See Logs if service is not active."
}
update_panel() {
  echo "Updating application files from GitHub. Database and environment file are preserved."
  local source tmp
  tmp="$(mktemp -d)"
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --branch "$BRANCH" "$REPO" "$tmp/source" >/dev/null 2>&1 || true
  fi
  if [[ ! -f "$tmp/source/nrb.py" ]]; then
    curl -fL --retry 3 "https://codeload.github.com/atifqmi-max/lvm-panel/zip/refs/heads/${BRANCH}" -o "$tmp/source.zip"
    unzip -q "$tmp/source.zip" -d "$tmp/unpacked"
    local top
    top="$(find "$tmp/unpacked" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    [[ -n "$top" && -f "$top/nrb.py" ]] || { echo "Update download did not contain nrb.py."; return 1; }
    mkdir -p "$tmp/source"
    cp -a "$top/." "$tmp/source/"
  fi
  [[ -f "$tmp/source/nrb.py" ]] || { echo "Could not download project source."; return 1; }
  # Preserve user uploads before replacing static assets from the new release.
  if [[ -d "$APP_DIR/static/uploads" ]]; then
    mkdir -p "$tmp/preserved-uploads"
    cp -a "$APP_DIR/static/uploads/." "$tmp/preserved-uploads/"
  fi
  systemctl stop "$SERVICE" || true
  for f in nrb.py api.py node.py lxd_backend.py security_utils.py templates static requirements.txt start.sh nrb-tool.sh README.md README_NRB.md; do
    [[ -e "$tmp/source/$f" ]] && { rm -rf "$APP_DIR/$f"; cp -a "$tmp/source/$f" "$APP_DIR/$f"; }
  done
  if [[ -d "$tmp/preserved-uploads" ]]; then
    mkdir -p "$APP_DIR/static/uploads"
    cp -a "$tmp/preserved-uploads/." "$APP_DIR/static/uploads/"
  fi
  cd "$APP_DIR"
  venv/bin/python -m pip install -r requirements.txt
  venv/bin/python -m py_compile nrb.py api.py node.py lxd_backend.py security_utils.py
  systemctl restart "$SERVICE"
  echo "Update complete."
}
firewall_panel() {
  if ! command -v ufw >/dev/null 2>&1; then apt-get update && apt-get install -y ufw; fi
  echo "Opening TCP/${PORT} with UFW. If your VPS provider has a cloud firewall, allow it there too."
  ufw allow "${PORT}/tcp"
  ufw status
}
system_info() {
  echo "== System =="; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
  uname -a; echo; echo "CPU: $(nproc 2>/dev/null || echo unknown) cores"
  free -h 2>/dev/null || true; df -h / 2>/dev/null || true
  echo; echo "Python: $(python3 --version 2>&1)"
  echo "LXD: $(command -v lxc || echo not-installed)"
  echo "Port: ${PORT}"
}
uninstall_panel() {
  echo "This removes the panel service and application code. Database/backups will be preserved unless separately deleted."
  read -r -p "Type REMOVE to continue: " answer
  [[ "$answer" == "REMOVE" ]] || { echo "Cancelled."; return; }
  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE}.service"
  systemctl daemon-reload
  if [[ -d "$APP_DIR" ]]; then
    mkdir -p /var/backups/lvm-panel
    [[ -f "$APP_DIR/nrb.db" ]] && cp -a "$APP_DIR/nrb.db" "/var/backups/lvm-panel/nrb-$(date +%Y%m%d-%H%M%S).db"
    rm -rf "$APP_DIR"
  fi
  rm -f /etc/lvm-panel.env
  echo "Panel removed. LXD was left installed because it may contain VPS instances."
}

menu() {
  while true; do
    clear 2>/dev/null || true
    printf '\033[1;35m'
    cat <<'BANNER'
╔══════════════════════════════════════════════════════════════╗
║                         LVM PANEL                            ║
║                 VPS Management • LXD Runtime                 ║
╚══════════════════════════════════════════════════════════════╝
BANNER
    printf '\033[0m'
    echo "  1) Install / Initialize LVM Panel"
    echo "  2) Start panel service"
    echo "  3) Stop panel service"
    echo "  4) Restart panel service"
    echo "  5) Service / LXD / port status"
    echo "  6) View recent logs"
    echo "  7) Open firewall port ${PORT}/tcp"
    echo "  8) Update panel from GitHub"
    echo "  9) Repair dependencies and service"
    echo " 10) System information"
    echo " 11) Uninstall panel (confirmation required; keeps LXD)"
    echo "  0) Exit"
    echo
    read -r -p "Choose an option [0-11]: " choice || exit 0
    case "$choice" in
      1) install_panel ;;
      2) start_panel ;;
      3) stop_panel ;;
      4) restart_panel ;;
      5) status_panel ;;
      6) logs_panel ;;
      7) firewall_panel ;;
      8) update_panel ;;
      9) repair_panel ;;
     10) system_info ;;
     11) uninstall_panel ;;
      0) exit 0 ;;
      *) echo "Invalid option. Choose 0-11." ;;
    esac
    echo
    read -r -p "Press Enter to return to menu..." _ || true
  done
}

need_root
if [[ "${1:-}" == "--install" ]]; then install_panel; exit $?; fi
if [[ "${1:-}" == "--menu" ]]; then menu; exit 0; fi

if [[ ! -f "$APP_DIR/nrb.py" ]]; then
  source_dir="$(bootstrap_source)"
  mkdir -p "$APP_DIR"
  cp -a "$source_dir/." "$APP_DIR/"
  exec bash "$APP_DIR/install.sh" --menu
fi
menu
