#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer with sudo: sudo bash install.sh" >&2
  exit 1
fi

init_process="$(ps -p 1 -o comm= 2>/dev/null | tr -d '[:space:]' || true)"
if [ "$init_process" != "systemd" ] || [ ! -d /run/systemd/system ]; then
  echo "Cannot install LXD here: PID 1 is '$init_process', not systemd. This looks like a container without a system service manager." >&2
  echo "The LXD snap requires a running snapd service. Install this panel on a full Ubuntu/Debian VM or VPS with systemd, and ask the provider to allow nested LXD if that VM is itself a container." >&2
  exit 1
fi

apt-get update
apt-get install -y python3 python3-pip python3-venv snapd socat
systemctl enable --now snapd.socket

if ! command -v snap >/dev/null 2>&1; then
  echo "Snap is unavailable. Install snapd for this Ubuntu/Debian host, then rerun this installer." >&2
  exit 1
fi
for attempt in $(seq 1 30); do
  if [ -S /run/snapd.socket ] && snap version >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! [ -S /run/snapd.socket ] || ! snap version >/dev/null 2>&1; then
  echo "snapd did not start. Check: systemctl status snapd.socket snapd --no-pager" >&2
  exit 1
fi
if ! snap list lxd >/dev/null 2>&1; then
  if ! snap install lxd; then
    echo "LXD snap installation failed. The host must allow snap image mounts, including loop devices and squashfs." >&2
    echo "If this is a containerized VPS/Codespace, install on a KVM VM or ask the provider to enable the required nested-container features." >&2
    exit 1
  fi
fi

# A fresh LXD daemon can answer `lxc info` before it has a usable instance profile.
systemctl enable --now snap.lxd.daemon || true
lxd waitready --timeout=120
storage_ready=0
network_ready=0
if lxc storage list --format=json 2>/dev/null | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin) else 1)'; then storage_ready=1; fi
if lxc network list --format=json 2>/dev/null | python3 -c 'import json,sys; sys.exit(0 if any(x.get("type") == "bridge" for x in json.load(sys.stdin)) else 1)'; then network_ready=1; fi
if [ "$storage_ready" -ne 1 ] || [ "$network_ready" -ne 1 ]; then
  lxd init --auto
fi
lxc info >/dev/null

if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  usermod -aG lxd "$SUDO_USER" || true
  echo "Added $SUDO_USER to the lxd group; log out and back in for group access."
fi

python3 -m venv venv
source venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
chmod +x start.sh nrb-tool.sh
python3 -m py_compile nrb.py lxd_backend.py api.py node.py

echo "LXD is initialized and responding."
echo "Start the panel with: bash start.sh"
echo "Panel port: 5000"
