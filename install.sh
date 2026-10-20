#!/usr/bin/env bash
# LVM Panel one-command installer and management menu.
set -Eeuo pipefail
APP_DIR="/opt/lvm-panel"
REPO="https://github.com/atifqmi-max/lvm-panel"
BRANCH="main"
SERVICE="lvm-panel"
REQUESTED_PORT="${PORT:-}"
PORT="${REQUESTED_PORT}"
if [[ -z "$PORT" && -r /etc/lvm-panel.env ]]; then
  PORT="$(sed -n 's/^PORT=//p' /etc/lvm-panel.env | head -n1)"
fi
PORT="${PORT:-5000}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "PORT must be an integer from 1 to 65535." >&2
  exit 2
fi
# Do not inspect BASH_SOURCE here: some Bash versions treat an empty
# BASH_SOURCE array as unbound under set -u when the script is piped to stdin.
# The installer fetches the selected repository into a temporary directory,
# so the caller's working directory is the only portable local fallback.
SCRIPT_DIR="$PWD"
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
  local tmp archive_url
  tmp="$(mktemp -d)"
  archive_url="https://codeload.github.com/atifqmi-max/lvm-panel/zip/refs/heads/${BRANCH}"
  echo "[1/3] Preparing temporary download directory..." >&2
  mkdir -p "$tmp/source" "$tmp/unpacked"
  echo "[2/3] Downloading LVM Panel source from GitHub (this may take a minute)..." >&2
  if ! curl -fL --retry 2 --connect-timeout 15 --max-time 180 --progress-bar "$archive_url" -o "$tmp/source.zip"; then
    echo "ERROR: GitHub source download failed or timed out." >&2
    echo "Check VPS DNS/network access to codeload.github.com and try again." >&2
    rm -rf "$tmp"
    return 1
  fi
  echo "[3/3] Extracting and validating source..." >&2
  if ! python3 - "$tmp/source.zip" "$tmp/unpacked" <<'PY'
import sys
import zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    archive.extractall(sys.argv[2])
PY
  then
    echo "ERROR: The downloaded source archive is invalid or Python zip support failed." >&2
    rm -rf "$tmp"
    return 1
  fi
  local top
  top="$(find "$tmp/unpacked" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  if [[ -z "$top" || ! -f "$top/nrb.py" || ! -f "$top/lxd_backend.py" ]]; then
    echo "ERROR: Downloaded repository is missing required application files." >&2
    rm -rf "$tmp"
    return 1
  fi
  cp -a "$top/." "$tmp/source/"
  echo "$tmp/source"
}

wait_for_health() {
  local url="http://127.0.0.1:${PORT}/api/v1/health"
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 2 "$url" 2>/dev/null | grep -Eq '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

install_panel() {
  echo
  echo "== Install / initialize LVM Panel =="
  if [[ -f "$APP_DIR/nrb.py" && -f /etc/lvm-panel.env ]]; then
    echo "LVM Panel is already installed. Use menu option 8 to update or option 9 to repair it."
    return 0
  fi
  local source
  source="$(bootstrap_source)"
  if [[ "$source" != "$APP_DIR" ]]; then
    mkdir -p "$APP_DIR"
    cp -a "$source/." "$APP_DIR/"
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y python3 python3-venv python3-pip ca-certificates curl unzip snapd socat ufw rsync
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
SESSION_COOKIE_SECURE=False
EOF
    chmod 600 /etc/lvm-panel.env
    printf '%s\n' "Initial admin credentials (save them now):" "Username: admin" "Password: $adminpass" | tee /root/lvm-panel-credentials.txt
    chmod 600 /root/lvm-panel-credentials.txt
  elif [[ -n "$REQUESTED_PORT" ]]; then
    if grep -q '^PORT=' /etc/lvm-panel.env; then
      sed -i "s/^PORT=.*/PORT=${PORT}/" /etc/lvm-panel.env
    else
      printf '\nPORT=${PORT}\n' >> /etc/lvm-panel.env
    fi
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
  if ! wait_for_health; then
    echo "The service started but its health endpoint did not become ready." >&2
    journalctl -u "$SERVICE" -n 80 --no-pager || true
    echo "Use menu option 6 for logs, or run: systemctl status ${SERVICE}" >&2
    return 1
  fi
  echo
  echo "Installation complete. Health check passed."
  echo "Panel: http://YOUR_SERVER_IP:${PORT}"
  echo "Credentials saved in: /root/lvm-panel-credentials.txt"
  echo "Security: use HTTPS behind a trusted reverse proxy before exposing login traffic publicly."
  echo "Node agent defaults to localhost; configure NODE_BIND_HOST and firewall rules for remote nodes."
  echo "Service: systemctl status ${SERVICE}"
}

start_panel() {
  systemctl start "$SERVICE"
  if wait_for_health; then systemctl --no-pager --full status "$SERVICE"; else
    echo "Panel did not become healthy after start." >&2
    journalctl -u "$SERVICE" -n 60 --no-pager || true
    return 1
  fi
}
stop_panel() { systemctl stop "$SERVICE"; echo "LVM Panel stopped."; }
restart_panel() {
  systemctl restart "$SERVICE"
  if wait_for_health; then systemctl --no-pager --full status "$SERVICE"; else
    echo "Panel did not become healthy after restart." >&2
    journalctl -u "$SERVICE" -n 60 --no-pager || true
    return 1
  fi
}
status_panel() {
  echo "== Service =="; systemctl --no-pager --full status "$SERVICE" || true
  echo; echo "== Application health =="
  if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/api/v1/health" 2>/dev/null; then
    echo
  else
    echo "Health endpoint is not responding on port ${PORT}."
  fi
  echo; echo "== LXD =="; if command -v lxc >/dev/null 2>&1; then lxc info 2>&1 | head -n 25 || true; else echo "LXD not installed"; fi
  echo; echo "== Listening port =="; ss -lntp 2>/dev/null | grep -E ":${PORT}[[:space:]]" || echo "Nothing listening on port ${PORT}"
}
logs_panel() { journalctl -u "$SERVICE" -n 100 --no-pager; }
repair_panel() {
  [[ -d "$APP_DIR" ]] || { echo "Panel is not installed. Choose Install first."; return 1; }
  apt-get update
  apt-get install -y python3 python3-venv python3-pip socat rsync curl
  cd "$APP_DIR"
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
  venv/bin/python -m py_compile nrb.py api.py node.py lxd_backend.py security_utils.py
  systemctl daemon-reload
  systemctl restart "$SERVICE"
  if ! wait_for_health; then
    echo "Repair finished, but health check failed." >&2
    journalctl -u "$SERVICE" -n 80 --no-pager || true
    return 1
  fi
  echo "Repair checks and health check passed."
}
update_panel() {
  echo "Preparing a staged update. Existing database, environment, uploads and virtualenv are preserved."
  [[ -d "$APP_DIR" && -f "$APP_DIR/nrb.py" ]] || { echo "Panel source is not installed at $APP_DIR." >&2; return 1; }

  local tmp backup_dir stamp update_ok=1 was_active=0 db_path=""
  tmp="$(mktemp -d)"
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="/var/backups/lvm-panel"
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  if ! command -v rsync >/dev/null 2>&1; then
    apt-get update && apt-get install -y rsync
  fi

  if command -v git >/dev/null 2>&1 && git clone --depth 1 --branch "$BRANCH" "$REPO" "$tmp/source" >/dev/null 2>&1; then
    :
  else
    rm -rf "$tmp/source"
    mkdir -p "$tmp/source"
    if ! curl -fL --retry 3 "https://codeload.github.com/atifqmi-max/lvm-panel/zip/refs/heads/${BRANCH}" -o "$tmp/source.zip"; then
      rm -rf "$tmp"
      echo "Could not download the update; the running application was not changed." >&2
      return 1
    fi
    if ! unzip -q "$tmp/source.zip" -d "$tmp/unpacked"; then
      rm -rf "$tmp"
      echo "Downloaded source archive is invalid; the running application was not changed." >&2
      return 1
    fi
    local top
    top="$(find "$tmp/unpacked" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    if [[ -z "$top" || ! -f "$top/nrb.py" ]]; then
      rm -rf "$tmp"
      echo "Downloaded source archive does not contain nrb.py." >&2
      return 1
    fi
    cp -a "$top/." "$tmp/source/"
  fi

  for f in nrb.py api.py node.py lxd_backend.py security_utils.py requirements.txt install.sh start.sh nrb-tool.sh; do
    if [[ ! -f "$tmp/source/$f" ]]; then
      rm -rf "$tmp"
      echo "Update is incomplete: required file $f is missing." >&2
      return 1
    fi
  done
  if ! bash -n "$tmp/source/install.sh" || ! python3 -m py_compile "$tmp/source/nrb.py" "$tmp/source/api.py" "$tmp/source/node.py" "$tmp/source/lxd_backend.py" "$tmp/source/security_utils.py"; then
    rm -rf "$tmp"
    echo "Update failed preflight syntax checks; the running application was not changed." >&2
    return 1
  fi

  # Stop writes before snapshotting SQLite so the rollback copy is consistent.
  if systemctl is-active --quiet "$SERVICE"; then
    was_active=1
    if ! systemctl stop "$SERVICE"; then
      rm -rf "$tmp"
      echo "Could not stop the service safely; update cancelled before changing application files." >&2
      return 1
    fi
  fi

  # Back up source plus database/uploads so a failed update can be rolled back.
  if ! rsync -a --delete --exclude='/venv/' --exclude='/nrb.log' --exclude='/__pycache__/' "$APP_DIR/" "$tmp/backup/"; then
    [[ "$was_active" -eq 1 ]] && systemctl start "$SERVICE" || true
    rm -rf "$tmp"
    echo "Could not create rollback snapshot; update cancelled." >&2
    return 1
  fi

  db_path="$(sed -n 's/^DATABASE_PATH=//p' /etc/lvm-panel.env 2>/dev/null | head -n1)"
  db_path="${db_path:-$APP_DIR/nrb.db}"
  if [[ "$db_path" != /* ]]; then db_path="$APP_DIR/$db_path"; fi
  if [[ -f "$db_path" && "$db_path" != "$APP_DIR/nrb.db" ]]; then
    if ! python3 - "$db_path" "$tmp/backup/external-database.sqlite3" <<'PY'
import sqlite3
import sys
source = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
try:
    source.backup(target)
finally:
    target.close()
    source.close()
PY
    then
      [[ "$was_active" -eq 1 ]] && systemctl start "$SERVICE" || true
      rm -rf "$tmp"
      echo "Could not snapshot the configured external database; update cancelled." >&2
      return 1
    fi
    printf '%s\\n' "$db_path" > "$tmp/backup/external-db-path.txt"
  fi

  if ! tar -czf "$backup_dir/lvm-panel-$stamp.tar.gz" -C "$tmp/backup" .; then
    [[ "$was_active" -eq 1 ]] && systemctl start "$SERVICE" || true
    rm -rf "$tmp"
    echo "Could not save rollback archive; update cancelled." >&2
    return 1
  fi
  chmod 600 "$backup_dir/lvm-panel-$stamp.tar.gz"

  if ! rsync -a --delete --exclude='/venv/' --exclude='/nrb.db' --exclude='/nrb.log' --exclude='/static/uploads/' --exclude='/__pycache__/' "$tmp/source/" "$APP_DIR/"; then
    update_ok=0
  elif ! "$APP_DIR/venv/bin/python" -m pip install -r "$APP_DIR/requirements.txt"; then
    update_ok=0
  elif ! "$APP_DIR/venv/bin/python" -m py_compile "$APP_DIR/nrb.py" "$APP_DIR/api.py" "$APP_DIR/node.py" "$APP_DIR/lxd_backend.py" "$APP_DIR/security_utils.py"; then
    update_ok=0
  elif ! systemctl daemon-reload || ! systemctl start "$SERVICE"; then
    update_ok=0
  elif ! wait_for_health; then
    update_ok=0
  fi

  if [[ "$update_ok" -ne 1 ]]; then
    echo "Update verification failed; restoring the previous application files." >&2
    systemctl stop "$SERVICE" >/dev/null 2>&1 || true
    if ! rsync -a --delete --exclude='/venv/' --exclude='/nrb.log' --exclude='/__pycache__/' "$tmp/backup/" "$APP_DIR/"; then
      echo "CRITICAL: automatic source rollback failed. Restore $backup_dir/lvm-panel-$stamp.tar.gz manually." >&2
      rm -rf "$tmp"
      return 1
    fi
    if [[ -f "$tmp/backup/external-db-path.txt" && -f "$tmp/backup/external-database.sqlite3" ]]; then
      db_path="$(cat "$tmp/backup/external-db-path.txt")"
      if ! python3 - "$tmp/backup/external-database.sqlite3" "$db_path" <<'PY'
import sqlite3
import sys
source = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
try:
    source.backup(target)
finally:
    target.close()
    source.close()
PY
      then
        echo "CRITICAL: external database rollback failed; restore the DB backup manually." >&2
        rm -rf "$tmp"
        return 1
      fi
    fi
    if [[ -x "$APP_DIR/venv/bin/python" && -f "$APP_DIR/requirements.txt" ]]; then
      "$APP_DIR/venv/bin/python" -m pip install -r "$APP_DIR/requirements.txt" || echo "Warning: dependency rollback needs attention." >&2
    fi
    systemctl daemon-reload || true
    systemctl start "$SERVICE" || true
    if ! wait_for_health; then
      echo "CRITICAL: previous files were restored, but the service is still unhealthy. Check logs." >&2
      journalctl -u "$SERVICE" -n 100 --no-pager || true
      rm -rf "$tmp"
      return 1
    fi
    rm -rf "$tmp"
    echo "Previous application restored and health check passed. Rollback archive: $backup_dir/lvm-panel-$stamp.tar.gz"
    return 1
  fi

  rm -rf "$tmp"
  echo "Update complete; health check passed."
  echo "Rollback archive: $backup_dir/lvm-panel-$stamp.tar.gz"
  echo "Service: systemctl status $SERVICE"
}

firewall_panel() {
  if ! command -v ufw >/dev/null 2>&1; then apt-get update && apt-get install -y ufw; fi
  echo "Adding an inbound rule for TCP/${PORT}. If your VPS provider has a cloud firewall, allow it there too."
  ufw allow "${PORT}/tcp"
  if ! ufw status | grep -q "Status: active"; then
    local ssh_port="22"
    if command -v sshd >/dev/null 2>&1; then
      ssh_port="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}')"
      ssh_port="${ssh_port:-22}"
    fi
    echo "UFW is currently inactive. Before enabling it, allowing SSH on TCP/${ssh_port}."
    ufw allow "${ssh_port}/tcp"
    read -r -p "Enable UFW now? Check your provider firewall and custom SSH port first [y/N]: " enable_ufw
    case "${enable_ufw,,}" in
      y|yes) ufw --force enable ;;
      *) echo "Rules were added, but UFW remains inactive. Enable it manually when remote access is confirmed." ;;
    esac
  fi
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
  echo "This removes the panel service and application code. A protected archive of the database, uploads, and environment config will be created first."
  read -r -p "Type REMOVE to continue: " answer
  [[ "$answer" == "REMOVE" ]] || { echo "Cancelled."; return; }

  local stamp backup_dir db_path
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup_dir="/var/backups/lvm-panel/uninstall-$stamp"
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"

  if [[ -f /etc/lvm-panel.env ]]; then
    cp -a /etc/lvm-panel.env "$backup_dir/lvm-panel.env"
    db_path="$(sed -n 's/^DATABASE_PATH=//p' /etc/lvm-panel.env | head -n1)"
  else
    db_path=""
  fi
  if [[ -n "$db_path" && "$db_path" != /* ]]; then db_path="$APP_DIR/$db_path"; fi
  if [[ -n "$db_path" && -f "$db_path" ]]; then cp -a "$db_path" "$backup_dir/database.sqlite3"; fi
  if [[ -d "$APP_DIR/static/uploads" ]]; then cp -a "$APP_DIR/static/uploads" "$backup_dir/uploads"; fi
  if [[ -f "$APP_DIR/nrb.db" && "$APP_DIR/nrb.db" != "$db_path" ]]; then cp -a "$APP_DIR/nrb.db" "$backup_dir/nrb.db"; fi
  if ! tar -czf "$backup_dir.tar.gz" -C "$(dirname "$backup_dir")" "$(basename "$backup_dir")"; then
    echo "Backup archive failed; refusing to uninstall." >&2
    return 1
  fi
  chmod 600 "$backup_dir.tar.gz"
  rm -rf "$backup_dir"

  systemctl disable --now "$SERVICE" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE}.service"
  systemctl daemon-reload
  rm -rf "$APP_DIR"
  rm -f /etc/lvm-panel.env
  echo "Panel removed. LXD was left installed because it may contain VPS instances."
  echo "Backup archive: $backup_dir.tar.gz"
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
      1) install_panel || { rc=$?; echo "Install option failed (exit $rc); menu remains available." >&2; } ;;
      2) start_panel || { rc=$?; echo "Start option failed (exit $rc); menu remains available." >&2; } ;;
      3) stop_panel || { rc=$?; echo "Stop option failed (exit $rc); menu remains available." >&2; } ;;
      4) restart_panel || { rc=$?; echo "Restart option failed (exit $rc); menu remains available." >&2; } ;;
      5) status_panel || { rc=$?; echo "Status option failed (exit $rc); menu remains available." >&2; } ;;
      6) logs_panel || { rc=$?; echo "Logs option failed (exit $rc); menu remains available." >&2; } ;;
      7) firewall_panel || { rc=$?; echo "Firewall option failed (exit $rc); menu remains available." >&2; } ;;
      8) update_panel || { rc=$?; echo "Update option failed (exit $rc); menu remains available." >&2; } ;;
      9) repair_panel || { rc=$?; echo "Repair option failed (exit $rc); menu remains available." >&2; } ;;
     10) system_info || { rc=$?; echo "System-info option failed (exit $rc); menu remains available." >&2; } ;;
     11) uninstall_panel || { rc=$?; echo "Uninstall option failed (exit $rc); menu remains available." >&2; } ;;
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
