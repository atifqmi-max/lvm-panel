#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v lxc >/dev/null 2>&1; then
  init_process="$(ps -p 1 -o comm= 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "$init_process" != "systemd" ] || [ ! -d /run/systemd/system ]; then
    echo "LXD is not installed, and this environment has no systemd service manager (PID 1: '$init_process')." >&2
    echo "The LXD snap cannot be installed/run here. Use a full Ubuntu/Debian VM or VPS with systemd; if nested, the provider must allow LXD nesting." >&2
  else
    echo "LXD client is missing. Run: sudo bash install.sh" >&2
  fi
  exit 1
fi
if ! lxc info >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    systemctl start snap.lxd.daemon 2>/dev/null || systemctl start lxd 2>/dev/null || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo systemctl start snap.lxd.daemon 2>/dev/null || sudo systemctl start lxd 2>/dev/null || true
  fi
fi
if ! lxc info >/dev/null 2>&1 && [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  echo "Current user cannot access LXD yet; retrying panel startup with sudo."
  exec sudo -E bash "$0" "$@"
fi
if ! lxc info >/dev/null 2>&1; then
  echo "LXD is not reachable. Check: sudo systemctl status snap.lxd.daemon --no-pager" >&2
  echo "Try: sudo lxd init --auto && sudo lxd waitready --timeout=120" >&2
  echo "If access is denied, add your login user to the lxd group and sign in again: sudo usermod -aG lxd '$USER'" >&2
  exit 1
fi

echo "LXD is ready. Starting LVM Panel on port 5000..."
if [ ! -d venv ]; then python3 -m venv venv; fi
source venv/bin/activate
python3 -m pip install -r requirements.txt
export PORT=5000
exec python3 nrb.py
